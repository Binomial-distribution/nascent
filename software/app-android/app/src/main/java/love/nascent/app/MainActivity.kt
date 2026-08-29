package love.nascent.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * 同一份 Web UI 的 Android 壳。
 *
 * 页面仍是 software/app/ 那套网站；系统 WebView 没有 Web Bluetooth，
 * 所以连玩具走 [BleBridge] 原生 GATT。
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var setup: LinearLayout
    private lateinit var urlField: EditText
    private lateinit var bridge: BleBridge
    private lateinit var heartRate: HeartRateBridge
    private var pendingMicRequest: PermissionRequest? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.web)
        setup = findViewById(R.id.setup)
        urlField = findViewById(R.id.server_url)
        val open = findViewById<Button>(R.id.open_site)
        val change = findViewById<Button>(R.id.change_server)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.cacheMode = WebSettings.LOAD_DEFAULT
        webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (!request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                        request.deny()
                        return@runOnUiThread
                    }
                    if (ContextCompat.checkSelfPermission(
                            this@MainActivity,
                            Manifest.permission.RECORD_AUDIO,
                        ) == PackageManager.PERMISSION_GRANTED
                    ) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                    } else {
                        pendingMicRequest = request
                        ActivityCompat.requestPermissions(
                            this@MainActivity,
                            arrayOf(Manifest.permission.RECORD_AUDIO),
                            REQ_MIC,
                        )
                    }
                }
            }
        }
        webView.webViewClient = WebViewClient()

        bridge = BleBridge(this, webView)
        webView.addJavascriptInterface(bridge, "NascentNative")
        heartRate = HeartRateBridge(this, webView)
        webView.addJavascriptInterface(heartRate, "NascentHeartRate")

        val stored = prefs().getString(KEY_URL, "") ?: ""
        if (stored.isBlank()) {
            showSetup()
        } else {
            loadSite(stored)
        }

        open.setOnClickListener {
            val url = normalize(urlField.text.toString())
            if (url == null) {
                Toast.makeText(this, "请输入 http:// 或 https:// 地址", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            prefs().edit().putString(KEY_URL, url).apply()
            loadSite(url)
        }
        change.setOnClickListener {
            bridge.disconnect()
            showSetup()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            val pending = pendingMicRequest
            pendingMicRequest = null
            if (granted && pending != null) {
                pending.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else {
                pending?.deny()
            }
            return
        }
        if (requestCode != BleBridge.REQ) return
        bridge.onPermissionResult(grantResults.isNotEmpty() && grantResults.all { it == android.content.pm.PackageManager.PERMISSION_GRANTED })
    }

    override fun onStart() {
        super.onStart()
        heartRate.start()
    }

    override fun onStop() {
        heartRate.stop()
        super.onStop()
    }

    override fun onDestroy() {
        bridge.disconnect()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (setup.visibility != LinearLayout.VISIBLE && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    private fun showSetup() {
        setup.visibility = LinearLayout.VISIBLE
        webView.visibility = WebView.GONE
        findViewById<Button>(R.id.change_server).visibility = Button.GONE
        urlField.setText(prefs().getString(KEY_URL, "http://10.0.2.2:8000"))
    }

    private fun loadSite(url: String) {
        setup.visibility = LinearLayout.GONE
        webView.visibility = WebView.VISIBLE
        findViewById<Button>(R.id.change_server).visibility = Button.VISIBLE
        webView.loadUrl(url)
    }

    private fun prefs() = getSharedPreferences("nascent", Context.MODE_PRIVATE)

    private fun normalize(raw: String): String? {
        val text = raw.trim().trimEnd('/')
        if (text.startsWith("http://") || text.startsWith("https://")) return text
        return null
    }

    companion object {
        private const val KEY_URL = "web_url"
        private const val REQ_MIC = 42
    }
}
