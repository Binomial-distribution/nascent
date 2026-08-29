package love.nascent.app

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * 把玩具的 GATT 接到 Web UI。这里是一条严格串行的 GATT 状态机：
 * 扫描 -> 连接 -> MTU -> 服务 -> CCCD -> Info -> Ready。
 *
 * Android 同一条 GATT 上一次只能有一个异步操作。尤其不能像旧实现那样在
 * CCCD write 尚未回调时紧接着 read Info；后一个调用会直接返回 false，页面
 * 等待的 Promise 就永远不会结束。
 */
class BleBridge(
    private val activity: MainActivity,
    private val webView: WebView,
) : BluetoothGattCallback() {
    private val main = Handler(Looper.getMainLooper())
    private val adapter: BluetoothAdapter? =
        activity.getSystemService(BluetoothManager::class.java)?.adapter

    private var gatt: BluetoothGatt? = null
    private var downChar: BluetoothGattCharacteristic? = null
    private var infoChar: BluetoothGattCharacteristic? = null
    private var notifyDescriptor: BluetoothGattDescriptor? = null
    private var pendingConfig: JSONObject? = null
    private var connecting = false
    private var scanCallback: ScanCallback? = null
    private var scanTimeout: Runnable? = null
    private var connectTimeout: Runnable? = null

    @JavascriptInterface
    fun available(): Boolean = adapter != null

    @JavascriptInterface
    fun connect(configJson: String) {
        main.post {
            val config = try {
                JSONObject(configJson)
            } catch (_: Exception) {
                rejectConnect("连接参数无效")
                return@post
            }
            pendingConfig = config
            if (!hasPermissions()) {
                notifyPhase("permission", "等待蓝牙权限")
                ActivityCompat.requestPermissions(activity, requiredPermissions(), REQ)
                return@post
            }
            startScan(config)
        }
    }

    @JavascriptInterface
    fun send(bodyJson: String): String {
        val ch = downChar ?: return "尚未连接设备"
        val currentGatt = gatt ?: return "尚未连接设备"
        val bytes = bodyJson.toByteArray(StandardCharsets.UTF_8)
        return try {
            if (writeCharacteristic(currentGatt, ch, bytes)) "" else "蓝牙写入未能启动"
        } catch (err: Exception) {
            err.message ?: "发送失败"
        }
    }

    @JavascriptInterface
    fun disconnect() {
        main.post {
            closeGatt()
            notifyPhase("idle", "设备未连接")
        }
    }

    fun onPermissionResult(granted: Boolean) {
        val config = pendingConfig
        if (!granted || config == null) {
            rejectConnect("需要蓝牙权限才能连接玩具")
            return
        }
        startScan(config)
    }

    @SuppressLint("MissingPermission")
    private fun startScan(config: JSONObject) {
        val bluetooth = adapter
        if (bluetooth == null) {
            rejectConnect("这台设备没有蓝牙")
            return
        }
        if (!bluetooth.isEnabled) {
            rejectConnect("请先打开蓝牙")
            return
        }

        closeGatt()
        pendingConfig = config
        connecting = true
        val scanner = bluetooth.bluetoothLeScanner
        if (scanner == null) {
            rejectConnect("无法启动蓝牙扫描")
            return
        }
        val name = config.optString("deviceName")
        val service = config.optString("serviceUuid")
        val filter = ScanFilter.Builder()
            .setDeviceName(name)
            .setServiceUuid(ParcelUuid.fromString(service))
            .build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                if (!connecting || scanCallback !== this) return
                stopScan()
                notifyPhase("connecting", "已找到玩具，正在连接")
                Log.i(TAG, "scan matched; starting GATT connection")
                val nextGatt = result.device.connectGatt(
                    activity,
                    false,
                    this@BleBridge,
                    BluetoothDevice.TRANSPORT_LE,
                )
                if (nextGatt == null) {
                    rejectConnect("无法创建蓝牙连接")
                    return
                }
                gatt = nextGatt
                scheduleConnectTimeout()
            }

            override fun onScanFailed(errorCode: Int) {
                if (scanCallback !== this) return
                rejectConnect("扫描失败：$errorCode")
            }
        }
        scanCallback = callback
        notifyPhase("scanning", "正在搜索 $name")
        Log.i(TAG, "starting filtered BLE scan")
        try {
            scanner.startScan(listOf(filter), settings, callback)
        } catch (err: Exception) {
            rejectConnect(err.message ?: "扫描启动失败")
            return
        }

        val timeout = Runnable {
            if (connecting && scanCallback === callback) {
                stopScan()
                rejectConnect("没有找到玩具 $name，请确认设备已开机后重试")
            }
        }
        scanTimeout = timeout
        main.postDelayed(timeout, SCAN_TIMEOUT_MS)
    }

    @SuppressLint("MissingPermission")
    override fun onConnectionStateChange(callbackGatt: BluetoothGatt, status: Int, newState: Int) {
        if (callbackGatt !== gatt) {
            try { callbackGatt.close() } catch (_: Exception) { }
            return
        }
        Log.i(TAG, "connection state=$newState status=$status")
        if (status != BluetoothGatt.GATT_SUCCESS || newState != BluetoothProfile.STATE_CONNECTED) {
            if (connecting) {
                rejectConnect("蓝牙连接失败（GATT $status），请靠近设备后重试")
            } else {
                js("window.__nascentNativeOnDisconnected && window.__nascentNativeOnDisconnected()")
                closeGatt()
                notifyPhase("idle", "设备连接已断开")
            }
            return
        }

        cancelConnectTimeout()
        notifyPhase("initializing", "正在协商蓝牙数据长度")
        val minMtu = pendingConfig?.optInt("minMtu", 185) ?: 185
        if (!callbackGatt.requestMtu(minMtu)) {
            rejectConnect("无法请求所需的蓝牙 MTU")
        }
    }

    @SuppressLint("MissingPermission")
    override fun onMtuChanged(callbackGatt: BluetoothGatt, mtu: Int, status: Int) {
        if (callbackGatt !== gatt || !connecting) return
        Log.i(TAG, "MTU changed mtu=$mtu status=$status")
        val minimum = pendingConfig?.optInt("minMtu", 185) ?: 185
        if (status != BluetoothGatt.GATT_SUCCESS || mtu < minimum) {
            rejectConnect("蓝牙 MTU 不足：需要 $minimum，当前 $mtu")
            return
        }
        notifyPhase("initializing", "正在发现设备服务")
        if (!callbackGatt.discoverServices()) {
            rejectConnect("设备服务发现未能启动")
        }
    }

    @SuppressLint("MissingPermission")
    override fun onServicesDiscovered(callbackGatt: BluetoothGatt, status: Int) {
        if (callbackGatt !== gatt || !connecting) return
        Log.i(TAG, "services discovered status=$status")
        if (status != BluetoothGatt.GATT_SUCCESS) {
            rejectConnect("发现设备服务失败（GATT $status）")
            return
        }
        val config = pendingConfig ?: return rejectConnect("内部错误：没有连接配置")
        val service = callbackGatt.getService(UUID.fromString(config.getString("serviceUuid")))
            ?: return rejectConnect("设备上没有 Nascent 服务")
        infoChar = service.getCharacteristic(UUID.fromString(config.getString("infoUuid")))
            ?: return rejectConnect("设备缺少 Info 特征")
        downChar = service.getCharacteristic(UUID.fromString(config.getString("downlinkUuid")))
            ?: return rejectConnect("设备缺少 Downlink 特征")
        val up = service.getCharacteristic(UUID.fromString(config.getString("uplinkUuid")))
            ?: return rejectConnect("设备缺少 Uplink 特征")
        if (!callbackGatt.setCharacteristicNotification(up, true)) {
            rejectConnect("无法启用设备实时数据")
            return
        }
        val cccd = up.getDescriptor(CCCD) ?: return rejectConnect("设备缺少通知描述符")
        notifyDescriptor = cccd
        notifyPhase("initializing", "正在订阅设备实时数据")
        if (!writeDescriptor(callbackGatt, cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) {
            rejectConnect("实时数据订阅未能启动")
        }
    }

    @SuppressLint("MissingPermission")
    override fun onDescriptorWrite(
        callbackGatt: BluetoothGatt,
        descriptor: BluetoothGattDescriptor,
        status: Int,
    ) {
        if (callbackGatt !== gatt || descriptor !== notifyDescriptor || !connecting) return
        Log.i(TAG, "CCCD write status=$status")
        if (status != BluetoothGatt.GATT_SUCCESS) {
            rejectConnect("订阅实时数据失败（GATT $status）")
            return
        }
        val info = infoChar ?: return rejectConnect("设备缺少 Info 特征")
        notifyPhase("initializing", "正在读取会话令牌")
        if (!callbackGatt.readCharacteristic(info)) {
            rejectConnect("会话令牌读取未能启动")
        }
    }

    override fun onCharacteristicRead(
        callbackGatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
        status: Int,
    ) {
        if (callbackGatt === gatt && characteristic === infoChar) handleInfo(value, status)
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicRead(
        callbackGatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        status: Int,
    ) {
        if (callbackGatt === gatt && characteristic === infoChar) {
            handleInfo(characteristic.value ?: ByteArray(0), status)
        }
    }

    override fun onCharacteristicChanged(
        callbackGatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
    ) {
        if (callbackGatt === gatt) emitUplink(value)
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicChanged(
        callbackGatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
    ) {
        if (callbackGatt === gatt) emitUplink(characteristic.value ?: ByteArray(0))
    }

    private fun handleInfo(value: ByteArray, status: Int) {
        if (!connecting) return
        if (status != BluetoothGatt.GATT_SUCCESS) {
            rejectConnect("读取会话令牌失败（GATT $status）")
            return
        }
        val json = try {
            JSONObject(String(value, StandardCharsets.UTF_8)).toString()
        } catch (_: Exception) {
            rejectConnect("设备返回的会话信息无效")
            return
        }
        connecting = false
        pendingConfig = null
        notifyDescriptor = null
        notifyPhase("ready", "设备已连接")
        Log.i(TAG, "GATT ready")
        js("window.__nascentNativeConnect && window.__nascentNativeConnect.resolve($json)")
    }

    private fun emitUplink(value: ByteArray) {
        val json = try {
            JSONObject(String(value, StandardCharsets.UTF_8)).toString()
        } catch (_: Exception) {
            Log.w(TAG, "dropping invalid uplink JSON")
            return
        }
        js("window.__nascentNativeOnUplink && window.__nascentNativeOnUplink($json)")
    }

    private fun rejectConnect(reason: String) {
        val shouldReject = connecting || pendingConfig != null
        connecting = false
        stopScan()
        cancelConnectTimeout()
        closeGatt()
        notifyPhase("error", reason)
        Log.w(TAG, reason)
        if (shouldReject) {
            val quoted = JSONObject.quote(reason)
            js("window.__nascentNativeConnect && window.__nascentNativeConnect.reject(new Error($quoted))")
        }
        pendingConfig = null
    }

    @SuppressLint("MissingPermission")
    private fun closeGatt() {
        stopScan()
        cancelConnectTimeout()
        connecting = false
        downChar = null
        infoChar = null
        notifyDescriptor = null
        val current = gatt
        gatt = null
        try { current?.disconnect() } catch (_: Exception) { }
        try { current?.close() } catch (_: Exception) { }
    }

    @SuppressLint("MissingPermission")
    private fun stopScan() {
        scanTimeout?.let(main::removeCallbacks)
        scanTimeout = null
        val callback = scanCallback
        scanCallback = null
        if (callback != null) {
            try { adapter?.bluetoothLeScanner?.stopScan(callback) } catch (_: Exception) { }
        }
    }

    private fun scheduleConnectTimeout() {
        cancelConnectTimeout()
        val timeout = Runnable {
            if (connecting && gatt != null) rejectConnect("连接设备超时，请重置设备后重试")
        }
        connectTimeout = timeout
        main.postDelayed(timeout, CONNECT_TIMEOUT_MS)
    }

    private fun cancelConnectTimeout() {
        connectTimeout?.let(main::removeCallbacks)
        connectTimeout = null
    }

    @SuppressLint("MissingPermission")
    private fun writeCharacteristic(
        callbackGatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
    ): Boolean = if (Build.VERSION.SDK_INT >= 33) {
        callbackGatt.writeCharacteristic(
            characteristic,
            value,
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT,
        ) == BluetoothStatusCodes.SUCCESS
    } else {
        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        characteristic.value = value
        callbackGatt.writeCharacteristic(characteristic)
    }

    @SuppressLint("MissingPermission")
    private fun writeDescriptor(
        callbackGatt: BluetoothGatt,
        descriptor: BluetoothGattDescriptor,
        value: ByteArray,
    ): Boolean = if (Build.VERSION.SDK_INT >= 33) {
        callbackGatt.writeDescriptor(descriptor, value) == BluetoothStatusCodes.SUCCESS
    } else {
        descriptor.value = value
        callbackGatt.writeDescriptor(descriptor)
    }

    private fun notifyPhase(phase: String, message: String) {
        val p = JSONObject.quote(phase)
        val m = JSONObject.quote(message)
        js("window.__nascentNativeOnConnectionState && window.__nascentNativeOnConnectionState($p, $m)")
    }

    private fun js(src: String) {
        main.post { webView.evaluateJavascript(src, null) }
    }

    private fun hasPermissions(): Boolean =
        requiredPermissions().all {
            ContextCompat.checkSelfPermission(activity, it) == PackageManager.PERMISSION_GRANTED
        }

    private fun requiredPermissions(): Array<String> = if (Build.VERSION.SDK_INT >= 31) {
        arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    companion object {
        const val REQ = 41
        private const val TAG = "NascentBle"
        private const val SCAN_TIMEOUT_MS = 15_000L
        private const val CONNECT_TIMEOUT_MS = 20_000L
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }
}
