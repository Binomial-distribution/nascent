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
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * 把行空板 GATT 接到 Web UI。UUID 一律由页面从 protocol.js 传入，这里不抄契约。
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
    private var pendingConfig: JSONObject? = null
    private var connecting = false

    @JavascriptInterface
    fun available(): Boolean = adapter != null

    @JavascriptInterface
    fun connect(configJson: String) {
        val config = JSONObject(configJson)
        main.post {
            pendingConfig = config
            if (!hasPermissions()) {
                ActivityCompat.requestPermissions(activity, requiredPermissions(), REQ)
                return@post
            }
            startScan(config)
        }
    }

    @JavascriptInterface
    fun send(bodyJson: String): String {
        val ch = downChar ?: return "尚未连接设备"
        val g = gatt ?: return "尚未连接设备"
        val bytes = bodyJson.toByteArray(StandardCharsets.UTF_8)
        return try {
            write(g, ch, bytes)
            ""
        } catch (err: Exception) {
            err.message ?: "发送失败"
        }
    }

    @JavascriptInterface
    fun disconnect() {
        main.post { close("user") }
    }

    fun onPermissionResult(granted: Boolean) {
        val config = pendingConfig
        if (!granted || config == null) {
            rejectConnect("需要蓝牙权限才能连接行空板")
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
        close("restart")
        connecting = true
        val scanner = bluetooth.bluetoothLeScanner
        val name = config.optString("deviceName")
        val service = config.optString("serviceUuid")
        val filters = listOf(
            ScanFilter.Builder().setDeviceName(name).build(),
            ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(service)).build(),
        )
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                scanner.stopScan(this)
                main.removeCallbacksAndMessages(null)
                result.device.connectGatt(
                    activity,
                    false,
                    this@BleBridge,
                    BluetoothDevice.TRANSPORT_LE,
                )
            }

            override fun onScanFailed(errorCode: Int) {
                rejectConnect("扫描失败：$errorCode")
            }
        }
        scanner.startScan(filters, settings, callback)
        main.postDelayed({
            scanner.stopScan(callback)
            if (connecting && gatt == null) rejectConnect("没有找到行空板 $name")
        }, 15_000)
    }

    @SuppressLint("MissingPermission")
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
        if (newState == BluetoothProfile.STATE_CONNECTED) {
            this.gatt = gatt
            gatt.requestMtu(pendingConfig?.optInt("minMtu", 185) ?: 185)
        } else {
            js("window.__nascentNativeOnDisconnected && window.__nascentNativeOnDisconnected()")
            close("lost")
        }
    }

    @SuppressLint("MissingPermission")
    override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
        gatt.discoverServices()
    }

    @SuppressLint("MissingPermission")
    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
        val config = pendingConfig ?: return rejectConnect("内部错误：没有配置")
        val service = gatt.getService(UUID.fromString(config.getString("serviceUuid")))
            ?: return rejectConnect("设备上没有 Nascent 服务")
        val info = service.getCharacteristic(UUID.fromString(config.getString("infoUuid")))
            ?: return rejectConnect("缺少 info 特征")
        downChar = service.getCharacteristic(UUID.fromString(config.getString("downlinkUuid")))
        val up = service.getCharacteristic(UUID.fromString(config.getString("uplinkUuid")))
            ?: return rejectConnect("缺少 uplink 特征")
        gatt.setCharacteristicNotification(up, true)
        val cccd = up.getDescriptor(CCCD)
        if (cccd != null) {
            writeDescriptor(gatt, cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
        }
        gatt.readCharacteristic(info)
    }

    override fun onCharacteristicRead(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
        status: Int,
    ) {
        handleInfo(value, status)
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicRead(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        status: Int,
    ) {
        handleInfo(characteristic.value ?: ByteArray(0), status)
    }

    override fun onCharacteristicChanged(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
    ) {
        emitUplink(value)
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicChanged(
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
    ) {
        emitUplink(characteristic.value ?: ByteArray(0))
    }

    private fun handleInfo(value: ByteArray, status: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS) {
            rejectConnect("读取会话令牌失败")
            return
        }
        val json = String(value, StandardCharsets.UTF_8)
        connecting = false
        js("window.__nascentNativeConnect && window.__nascentNativeConnect.resolve($json)")
    }

    private fun emitUplink(value: ByteArray) {
        val json = String(value, StandardCharsets.UTF_8)
        js("window.__nascentNativeOnUplink && window.__nascentNativeOnUplink($json)")
    }

    private fun rejectConnect(reason: String) {
        connecting = false
        val quoted = JSONObject.quote(reason)
        js("window.__nascentNativeConnect && window.__nascentNativeConnect.reject(new Error($quoted))")
        close("fail")
    }

    @SuppressLint("MissingPermission")
    private fun close(reason: String) {
        connecting = false
        downChar = null
        try {
            gatt?.disconnect()
            gatt?.close()
        } catch (_: Exception) {
        }
        gatt = null
        if (reason == "lost" || reason == "user") {
            // already notified or initiated by JS
        }
    }

    @SuppressLint("MissingPermission")
    private fun write(gatt: BluetoothGatt, ch: BluetoothGattCharacteristic, bytes: ByteArray) {
        if (Build.VERSION.SDK_INT >= 33) {
            gatt.writeCharacteristic(ch, bytes, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
        } else {
            ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            ch.value = bytes
            gatt.writeCharacteristic(ch)
        }
    }

    @SuppressLint("MissingPermission")
    private fun writeDescriptor(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, value: ByteArray) {
        if (Build.VERSION.SDK_INT >= 33) {
            gatt.writeDescriptor(descriptor, value)
        } else {
            descriptor.value = value
            gatt.writeDescriptor(descriptor)
        }
    }

    private fun js(src: String) {
        main.post { webView.evaluateJavascript(src, null) }
    }

    private fun hasPermissions(): Boolean =
        requiredPermissions().all {
            ContextCompat.checkSelfPermission(activity, it) == PackageManager.PERMISSION_GRANTED
        }

    private fun requiredPermissions(): Array<String> {
        return if (Build.VERSION.SDK_INT >= 31) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    companion object {
        const val REQ = 41
        private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }
}
