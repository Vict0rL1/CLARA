import AppIntents
import Foundation

// Abrir una pantalla de Clara desde fuera (Fase 4, decisión 185): el control del Centro de control y la pantalla
// bloqueada (`ios/ClaraWidgetsSources/`) y la acción «Nuevo gasto en Clara» (`ClaraShortcuts.swift`).
//
// Este archivo pertenece A LA VEZ a la app y a la extensión de widgets (cuando exista): Apple lo exige para que un
// control abra la app con un `OpenIntent` («The system requires the Target Membership of the app intent to be set to
// both the app and the widget extension to open the app», «Creating controls to perform actions across the system»).
// Por eso solo usa Foundation y App Intents.
//
// El Swift no sabe de rutas: dice QUÉ pantalla se pidió (`ClaraScreen`) y la web decide cómo abrirla
// (`src/platform/launch.ts`).
//
// APIs comprobadas en developer.apple.com: `OpenIntent` (iOS 16; `target`, el sistema trae la app al primer plano para
// ejecutarla), `AppEnum` (`typeDisplayRepresentation`, `caseDisplayRepresentations`), `TypeDisplayRepresentation`,
// `DisplayRepresentation`, `IntentResult.result()`.

/// Las pantallas que se pueden abrir desde fuera. Solo las que existen.
enum ClaraScreen: String, AppEnum {
    case newExpense

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Clara screen")
    static let caseDisplayRepresentations: [ClaraScreen: DisplayRepresentation] = [
        .newExpense: DisplayRepresentation(title: "New expense"),
    ]
}

/// Abre Clara en esa pantalla. Es la acción del control (`ControlWidgetButton`).
struct OpenClaraIntent: OpenIntent {
    static let title: LocalizedStringResource = "Open in Clara"
    static let description: IntentDescription? = IntentDescription("Opens Clara on the screen you choose.")

    @Parameter(title: "Screen")
    var target: ClaraScreen

    init() {}

    init(target: ClaraScreen) {
        self.target = target
    }

    func perform() async throws -> some IntentResult {
        ClaraLaunchRequests.request(target)
        return .result()
    }
}

/// La pantalla pedida, hasta que la web la recoge. La acción puede ejecutarse antes de que la web haya cargado (al
/// abrir la app desde cero): se guarda aquí y la web la pide al arrancar (`ClaraLaunchPlugin.take`); con la app ya
/// abierta, el aviso `claraOpenScreen` hace que el plugin se la pase en el acto. Solo memoria: no se escribe nada.
enum ClaraLaunchRequests {
    private static let lock = NSLock()
    private static var pending: ClaraScreen?

    static func request(_ screen: ClaraScreen) {
        lock.lock()
        pending = screen
        lock.unlock()
        NotificationCenter.default.post(name: .claraOpenScreen, object: nil)
    }

    /// La pantalla pendiente, una sola vez.
    static func take() -> ClaraScreen? {
        lock.lock()
        defer { lock.unlock() }
        let screen = pending
        pending = nil
        return screen
    }
}

extension Notification.Name {
    /// Alguien pidió abrir una pantalla de Clara con la app abierta.
    static let claraOpenScreen = Notification.Name("ClaraOpenScreen")
}
