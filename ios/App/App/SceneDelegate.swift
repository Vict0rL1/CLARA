import UIKit
import WebKit
import Capacitor

/// La vista web de Clara. Registra los plugins propios (código nativo dentro del target de la app, decisión 155) y
/// activa el gesto de «atrás» deslizando desde el borde, como en Safari y en la Clara de la pantalla de inicio
/// (Capacitor lo deja apagado).
class ClaraViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(ClaraStoragePlugin())
        bridge?.registerPluginInstance(ClaraBiometricPlugin())
        bridge?.registerPluginInstance(ClaraCapturesPlugin())
        webView?.allowsBackForwardNavigationGestures = true
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ClaraViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
