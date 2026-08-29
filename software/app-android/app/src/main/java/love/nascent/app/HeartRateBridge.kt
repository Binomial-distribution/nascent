package love.nascent.app

import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * 把 Gadgetbridge 的心率 Broadcast 转进 Web UI。
 * 不接触 BleBridge，也不提供任何发往玩具的方法。
 */
class HeartRateBridge(
    private val activity: MainActivity,
    private val webView: WebView,
) {
    private val main = Handler(Looper.getMainLooper())
    private val receiver = HeartRateReceiver(::emit)
    private var registered = false
    private var lastTimestamp = 0L

    @JavascriptInterface
    fun available(): Boolean = true

    fun start() {
        if (registered) return
        ContextCompat.registerReceiver(
            activity,
            receiver,
            IntentFilter(HeartRateReceiver.ACTION),
            HeartRateReceiver.PERMISSION,
            null,
            ContextCompat.RECEIVER_EXPORTED,
        )
        registered = true
    }

    fun stop() {
        if (!registered) return
        try {
            activity.unregisterReceiver(receiver)
        } catch (_: Exception) {
        }
        registered = false
    }

    private fun emit(sample: HeartRateSample) {
        if (sample.timestampMs <= lastTimestamp) return
        lastTimestamp = sample.timestampMs
        val json = JSONObject()
            .put("bpm", sample.bpm)
            .put("timestampMs", sample.timestampMs)
            .put("source", sample.source)
            .put("quality", sample.quality)
            .toString()
        main.post {
            webView.evaluateJavascript(
                "window.__nascentOnHeartRateSample && window.__nascentOnHeartRateSample($json)",
                null,
            )
        }
    }
}
