import Foundation
import LocalAuthentication
import Capacitor

/// Face ID o Touch ID para el bloqueo de Clara (decisión 165).
///
/// Solo pregunta al sistema si quien mira es la persona dueña del iPhone. No guarda nada, no ve los datos y no cifra:
/// el bloqueo de Clara sigue siendo una barrera de pantalla. La alternativa es el PIN de Clara, en su propia pantalla,
/// así que aquí no se ofrece el código del iPhone (`deviceOwnerAuthenticationWithBiometrics` y sin botón de respaldo).
///
/// APIs comprobadas en developer.apple.com (LocalAuthentication): `LAContext.canEvaluatePolicy(_:error:)`,
/// `LAContext.evaluatePolicy(_:localizedReason:reply:)`, `LAPolicy.deviceOwnerAuthenticationWithBiometrics`,
/// `LAContext.biometryType`, `LAContext.localizedFallbackTitle`, `LAErrorDomain` y `LAError.Code`.
/// El texto con el que iOS pide permiso la primera vez es `NSFaceIDUsageDescription` (Info.plist).
///
/// Motivos que devuelve (los lee `src/platform/biometric.ts`): `cancelled`, `fallback`, `lockout`, `notAvailable`,
/// `notEnrolled`, `passcodeNotSet`, `failed`.
@objc(ClaraBiometricPlugin)
public class ClaraBiometricPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClaraBiometricPlugin"
    public let jsName = "ClaraBiometric"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)
    ]

    /// ¿Se puede usar la biometría ahora? `type`: `faceID`, `touchID`, `opticID` o `none`.
    @objc func availability(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        var result: [String: Any] = ["available": available, "type": ClaraBiometricPlugin.typeName(context.biometryType)]
        if !available {
            result["reason"] = ClaraBiometricPlugin.reason(error)
        }
        call.resolve(result)
    }

    /// Pide la biometría. Resuelve siempre: `ok` verdadero, o falso con el motivo. Solo rechaza si falta el texto.
    @objc func authenticate(_ call: CAPPluginCall) {
        guard let reason = call.getString("reason"), !reason.isEmpty else {
            call.reject("Falta el texto que explica para qué se pide", "invalidArguments")
            return
        }
        let context = LAContext()
        // Cadena vacía: iOS no muestra el botón de respaldo. La alternativa es el PIN de Clara.
        context.localizedFallbackTitle = ""
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            call.resolve(["ok": false, "reason": ClaraBiometricPlugin.reason(error)])
            return
        }
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, evaluationError in
            if success {
                call.resolve(["ok": true])
            } else {
                let nsError = evaluationError.map { $0 as NSError }
                call.resolve(["ok": false, "reason": ClaraBiometricPlugin.reason(nsError)])
            }
        }
    }

    static func typeName(_ type: LABiometryType) -> String {
        switch type {
        case .faceID: return "faceID"
        case .touchID: return "touchID"
        case .opticID: return "opticID"
        default: return "none"
        }
    }

    static func reason(_ error: NSError?) -> String {
        guard let error = error, error.domain == LAErrorDomain, let code = LAError.Code(rawValue: error.code) else {
            return "failed"
        }
        switch code {
        case .userCancel, .systemCancel, .appCancel: return "cancelled"
        case .userFallback: return "fallback"
        case .biometryLockout: return "lockout"
        case .biometryNotAvailable: return "notAvailable"
        case .biometryNotEnrolled: return "notEnrolled"
        case .passcodeNotSet: return "passcodeNotSet"
        default: return "failed"
        }
    }
}
