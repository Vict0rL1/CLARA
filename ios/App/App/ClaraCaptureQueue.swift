import Foundation

/// Cola de capturas automáticas (Fase 2, decisión 169): un archivo `captures.jsonl` con una línea JSON por pago.
///
/// La acción «Registrar pago en Clara» (App Intent) solo AÑADE líneas; la web las lee al abrirse Clara
/// (`src/domain/captureQueue.ts`), decide qué hacer con cada una y, cuando lo ha guardado, pide quitar esas líneas
/// (`remove(ids:)`). Aquí no se interpreta el importe ni se calcula nada: el Swift transporta texto.
///
/// Dónde vive: en el App Group `group.com.victorli.clara` si la app tiene ese permiso (hace falta para los widgets de
/// una fase posterior y no está disponible con una cuenta gratuita de Apple); si no, en Application Support/Clara.
/// La acción se ejecuta dentro del proceso de la propia app, así que basta con esa carpeta. Se leen y se limpian las dos
/// ubicaciones para que activar el App Group más adelante no deje pagos olvidados en la otra.
///
/// Solo usa Foundation: no sabe nada de Capacitor ni de App Intents.
final class ClaraCaptureQueue {
    enum QueueError: Error, Equatable {
        /// Ya hay `maxLines` pagos esperando: Clara tiene que abrirse para leerlos antes de aceptar más.
        case full
        /// El sistema no dejó leer o escribir.
        case unavailable(String)
    }

    static let appGroup = "group.com.victorli.clara"
    static let fileName = "captures.jsonl"
    /// Pagos esperando como mucho (la web acepta 500 propuestas; esto es una cota de seguridad del archivo).
    static let maxLines = 1000

    /// Un solo escritor a la vez dentro del proceso: la acción y el plugin pueden coincidir.
    private static let lock = NSLock()

    /// Carpetas, la primera es donde se escribe.
    let directories: [URL]

    init(directories: [URL]) {
        self.directories = directories
    }

    /// Las de la app: el App Group si existe y, siempre, Application Support/Clara.
    static func standard() -> ClaraCaptureQueue {
        var dirs: [URL] = []
        if let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) {
            dirs.append(group.appendingPathComponent("Clara", isDirectory: true))
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dirs.append(support.appendingPathComponent("Clara", isDirectory: true))
        return ClaraCaptureQueue(directories: dirs)
    }

    private func fileURL(_ directory: URL) -> URL {
        directory.appendingPathComponent(ClaraCaptureQueue.fileName, isDirectory: false)
    }

    /// Una línea de la cola, con las claves que lee `captureQueue.ts`. Las vacías no se escriben.
    static func line(captureId: String, createdAt: Date, origin: String, rawAmount: String, currencyHint: String?, merchant: String?, card: String?, test: Bool = false) throws -> String {
        var record: [String: Any] = [
            "captureId": captureId,
            "createdAt": iso8601(createdAt),
            "origin": origin,
            "rawAmount": rawAmount,
        ]
        if let hint = currencyHint, !hint.isEmpty { record["currencyHint"] = hint }
        if let merchant = merchant?.trimmingCharacters(in: .whitespacesAndNewlines), !merchant.isEmpty { record["merchant"] = merchant }
        if let card = card?.trimmingCharacters(in: .whitespacesAndNewlines), !card.isEmpty { record["card"] = card }
        if test { record["test"] = true }
        let data = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys, .withoutEscapingSlashes])
        // JSONSerialization nunca escribe saltos de línea sin escapar: una línea por pago.
        return String(decoding: data, as: UTF8.self)
    }

    /// `2026-12-20T03:14:15Z`: UTC, sin fracciones (lo que acepta `captureQueue.ts`).
    static func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }

    /// Añade una línea al final del archivo de la primera carpeta.
    func append(_ line: String) throws {
        ClaraCaptureQueue.lock.lock()
        defer { ClaraCaptureQueue.lock.unlock() }
        guard let directory = directories.first else { throw QueueError.unavailable("no directory") }
        do {
            if lineCount() >= ClaraCaptureQueue.maxLines { throw QueueError.full }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = fileURL(directory)
            if !FileManager.default.fileExists(atPath: url.path) {
                guard FileManager.default.createFile(atPath: url.path, contents: nil) else { throw QueueError.unavailable("create") }
            }
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            // Si la última línea quedó a medias (la app se cerró escribiendo), se empieza en una línea nueva.
            if try handle.offset() > 0, let last = try lastByte(url), last != 0x0A {
                try handle.write(contentsOf: Data([0x0A]))
            }
            try handle.write(contentsOf: Data((line + "\n").utf8))
        } catch let error as QueueError {
            throw error
        } catch {
            throw QueueError.unavailable(error.localizedDescription)
        }
    }

    private func lastByte(_ url: URL) throws -> UInt8? {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let size = try handle.seekToEnd()
        guard size > 0 else { return nil }
        try handle.seek(toOffset: size - 1)
        return try handle.read(upToCount: 1)?.first
    }

    /// Todo lo que espera, de todas las carpetas, tal cual (la web lo valida línea a línea).
    func readAll() throws -> String {
        ClaraCaptureQueue.lock.lock()
        defer { ClaraCaptureQueue.lock.unlock() }
        var parts: [String] = []
        for directory in directories {
            let url = fileURL(directory)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            do {
                var text = String(decoding: try Data(contentsOf: url), as: UTF8.self)
                if !text.isEmpty && !text.hasSuffix("\n") && directory != directories.first {
                    text += "\n"
                }
                parts.append(text)
            } catch {
                throw QueueError.unavailable(error.localizedDescription)
            }
        }
        // La carpeta donde se escribe va al final: su última línea puede estar escribiéndose (la web la deja para luego).
        if parts.count > 1 { parts.append(parts.removeFirst()) }
        return parts.joined()
    }

    private func lineCount() -> Int {
        directories.reduce(0) { total, directory in
            guard let data = try? Data(contentsOf: fileURL(directory)) else { return total }
            return total + data.split(separator: 0x0A, omittingEmptySubsequences: true).count
        }
    }

    /// Quita las líneas de esos pagos (ya guardados en Clara). Una línea que no se entiende se conserva: nunca se borra
    /// lo que no se ha podido leer. Cada archivo se reescribe de forma atómica. Devuelve cuántas se quitaron.
    @discardableResult
    func remove(ids: Set<String>) throws -> Int {
        ClaraCaptureQueue.lock.lock()
        defer { ClaraCaptureQueue.lock.unlock() }
        var removed = 0
        for directory in directories {
            let url = fileURL(directory)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            do {
                let text = String(decoding: try Data(contentsOf: url), as: UTF8.self)
                var kept: [Substring] = []
                for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
                    if let id = ClaraCaptureQueue.captureId(of: line), ids.contains(id) {
                        removed += 1
                    } else {
                        kept.append(line)
                    }
                }
                let next = kept.isEmpty ? "" : kept.joined(separator: "\n") + "\n"
                try Data(next.utf8).write(to: url, options: [.atomic])
            } catch {
                throw QueueError.unavailable(error.localizedDescription)
            }
        }
        return removed
    }

    static func captureId(of line: Substring) -> String? {
        guard let object = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { return nil }
        return object["captureId"] as? String
    }
}
