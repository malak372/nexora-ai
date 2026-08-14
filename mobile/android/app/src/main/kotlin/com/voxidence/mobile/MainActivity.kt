package com.voxidence.mobile

import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

/**
 * Android host activity for Voxidence.
 *
 * Android 12+ always owns a short native launch window before Flutter can draw
 * its first frame. We remove the platform splash exit animation so there is no
 * extra white/fade frame between that native window and the Flutter loader.
 *
 * @author Eman
 */
class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            splashScreen.setOnExitAnimationListener { splashScreenView ->
                splashScreenView.remove()
            }
        }

        super.onCreate(savedInstanceState)
    }
}
