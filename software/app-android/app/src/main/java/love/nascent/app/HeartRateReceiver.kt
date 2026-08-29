package love.nascent.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 接收 Gadgetbridge fork 发出的实时 BPM。权限与 action 见
 * docs/implementation/mi-band7-gadgetbridge-bridge.md。
 * 这里不做平滑或趋势，更不能发玩具指令。
 */
class HeartRateReceiver(
    private val onSample: (HeartRateSample) -> Unit,
) : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return

        val bpm = intent.getIntExtra("bpm", -1)
        val timestamp = intent.getLongExtra("timestamp_ms", 0L)
        val source = intent.getStringExtra("source") ?: "unknown"
        val quality = intent.getIntExtra("quality", -1)

        if (bpm !in BPM_MIN..BPM_MAX || timestamp <= 0L) return

        onSample(
            HeartRateSample(
                bpm = bpm,
                timestampMs = timestamp,
                source = source,
                quality = quality,
            ),
        )
    }

    companion object {
        const val ACTION = "love.nascent.action.HEART_RATE_SAMPLE"
        const val PERMISSION = "love.nascent.permission.RECEIVE_HEART_RATE"
        const val BPM_MIN = 30
        const val BPM_MAX = 240
    }
}

data class HeartRateSample(
    val bpm: Int,
    val timestampMs: Long,
    val source: String,
    val quality: Int,
)
