import Foundation
import Capacitor

/// La pantalla que se pidió abrir desde fuera de la app (Fase 4, decisión 185): «Nuevo gasto en Clara» o el control
/// del Centro de control. Transporta el nombre de la pantalla; la ruta la decide la web (`src/platform/launch.ts`).
///
/// - `take()` → `{ screen }` («newExpense») o `{}`: la pantalla pendiente, una sola vez. La web lo pide al arrancar,
///   porque la acción pudo ejecutarse antes de que la web cargara.
/// - Evento `openScreen` (sin datos): alguien pidió una pantalla con la app ya abierta; la web la recoge con `take()`.
///   Así no se pierde si el aviso llega antes de que la web escuche, ni se abre dos veces.
@objc(ClaraLaunchPlugin)
public class ClaraLaunchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClaraLaunchPlugin"
    public let jsName = "ClaraLaunch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise)
    ]

    private var observer: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(forName: .claraOpenScreen, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("openScreen", data: [:])
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    @objc func take(_ call: CAPPluginCall) {
        if let screen = ClaraLaunchRequests.take() {
            call.resolve(["screen": screen.rawValue])
        } else {
            call.resolve([:])
        }
    }
}
