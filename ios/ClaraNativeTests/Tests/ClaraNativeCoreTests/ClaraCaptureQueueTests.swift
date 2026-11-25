import XCTest
@testable import ClaraNativeCore

/// La cola de capturas (`ClaraCaptureQueue`): el contrato que lee `src/domain/captureQueue.ts`.
final class ClaraCaptureQueueTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("clara-queue-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func queue(_ names: String...) -> ClaraCaptureQueue {
        ClaraCaptureQueue(directories: names.map { root.appendingPathComponent($0, isDirectory: true) })
    }

    private func record(_ id: String, amount: String = "4.25", test: Bool = false) throws -> String {
        try ClaraCaptureQueue.line(captureId: id, createdAt: Date(timeIntervalSince1970: 1_790_000_000), origin: "apple_pay", rawAmount: amount, currencyHint: "CAD", merchant: " Tim Hortons ", card: "", test: test)
    }

    func testLineHasTheKeysTheWebReadsAndNoNewline() throws {
        let line = try record("cap-00000001")
        XCTAssertFalse(line.contains("\n"))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        XCTAssertEqual(object["captureId"] as? String, "cap-00000001")
        XCTAssertEqual(object["createdAt"] as? String, "2026-09-21T14:13:20Z")
        XCTAssertEqual(object["origin"] as? String, "apple_pay")
        XCTAssertEqual(object["rawAmount"] as? String, "4.25")
        XCTAssertEqual(object["currencyHint"] as? String, "CAD")
        XCTAssertEqual(object["merchant"] as? String, "Tim Hortons")
        XCTAssertNil(object["card"], "una tarjeta vacía no se escribe")
        XCTAssertNil(object["test"])
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(try record("x", test: true).utf8)) as? NSDictionary, ["captureId": "x", "createdAt": "2026-09-21T14:13:20Z", "origin": "apple_pay", "rawAmount": "4.25", "currencyHint": "CAD", "merchant": "Tim Hortons", "test": true] as NSDictionary)
    }

    /// Fase 4: «Registrar desde texto» escribe solo el texto del aviso, sin importe; la web lo interpreta.
    func testATextLineHasNoAmountAndKeepsTheText() throws {
        let line = try ClaraCaptureQueue.line(captureId: "cap-sms00001", createdAt: Date(timeIntervalSince1970: 1_790_000_000), origin: "bank_text", rawAmount: nil, currencyHint: nil, merchant: nil, card: nil, rawText: "  Aviso\ncon dos líneas  ")
        XCTAssertFalse(line.contains("\n"), "el salto de línea del aviso va escapado: una línea por captura")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: Data(line.utf8)) as? NSDictionary, ["captureId": "cap-sms00001", "createdAt": "2026-09-21T14:13:20Z", "origin": "bank_text", "rawText": "Aviso\ncon dos líneas"] as NSDictionary)
    }

    /// La web no acepta más de 2 000 unidades UTF-16 (`CAPTURE_TEXT_MAX`): se recorta antes, sin partir un emoji.
    func testLongTextIsClippedInUTF16WithoutSplittingACharacter() throws {
        XCTAssertEqual(ClaraCaptureQueue.clip("abc", maxUTF16: 2000), "abc")
        let long = String(repeating: "a", count: 1999) + "😀" + "b"
        let clipped = ClaraCaptureQueue.clip(long, maxUTF16: 2000)
        XCTAssertEqual(clipped, String(repeating: "a", count: 1999), "el emoji (2 unidades) ya no cabe entero")
        XCTAssertEqual(ClaraCaptureQueue.clip(String(repeating: "a", count: 1998) + "😀b", maxUTF16: 2000).utf16.count, 2000)
        let line = try ClaraCaptureQueue.line(captureId: "cap-sms00002", createdAt: Date(), origin: "bank_text", rawAmount: nil, currencyHint: nil, merchant: nil, card: nil, rawText: String(repeating: "x", count: 5000))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        XCTAssertEqual((object["rawText"] as? String)?.utf16.count, 2000)
    }

    func testDecimalDescriptionIsCanonicalWithADot() {
        // Lo que escribe la acción con `IntentCurrencyAmount.amount`: siempre con punto, sin separador de miles.
        XCTAssertEqual(Decimal(string: "1200")!.description, "1200")
        XCTAssertEqual(Decimal(string: "12.5")!.description, "12.5")
        XCTAssertEqual((Decimal(1234) + Decimal(string: "0.56")!).description, "1234.56")
    }

    func testAppendReadAndRemoveOnlyThoseIds() throws {
        let q = queue("a")
        try q.append(try record("cap-00000001"))
        try q.append(try record("cap-00000002", amount: "18.40"))
        XCTAssertEqual(try q.readAll().split(separator: "\n").count, 2)
        XCTAssertEqual(try q.remove(ids: ["cap-00000001", "no-existe"]), 1)
        let left = try q.readAll()
        XCTAssertTrue(left.contains("cap-00000002"))
        XCTAssertFalse(left.contains("cap-00000001"))
        XCTAssertTrue(left.hasSuffix("\n"))
        XCTAssertEqual(try q.remove(ids: ["cap-00000002"]), 1)
        XCTAssertEqual(try q.readAll(), "")
    }

    func testALineThatCannotBeReadIsNeverRemoved() throws {
        let q = queue("a")
        try FileManager.default.createDirectory(at: q.directories[0], withIntermediateDirectories: true)
        let url = q.directories[0].appendingPathComponent(ClaraCaptureQueue.fileName)
        try Data("not json\n\(try record("cap-00000001"))\n".utf8).write(to: url)
        XCTAssertEqual(try q.remove(ids: ["cap-00000001"]), 1)
        XCTAssertEqual(try q.readAll(), "not json\n")
    }

    func testAHalfWrittenLastLineStartsANewLine() throws {
        let q = queue("a")
        try FileManager.default.createDirectory(at: q.directories[0], withIntermediateDirectories: true)
        let url = q.directories[0].appendingPathComponent(ClaraCaptureQueue.fileName)
        try Data("{\"captureId\":\"cut".utf8).write(to: url)
        try q.append(try record("cap-00000001"))
        let lines = try q.readAll().split(separator: "\n")
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(ClaraCaptureQueue.captureId(of: lines[1]), "cap-00000001")
    }

    func testConcurrentWritersKeepEveryLineWhole() throws {
        // La acción de Atajos y «Probar» pueden escribir a la vez, cada una con su instancia: ninguna línea se mezcla.
        let a = queue("a")
        let b = queue("a")
        let lines = try (0..<60).map { try record(String(format: "cap-%08d", $0)) }
        DispatchQueue.concurrentPerform(iterations: lines.count) { i in
            try? (i % 2 == 0 ? a : b).append(lines[i])
        }
        let read = try a.readAll().split(separator: "\n")
        XCTAssertEqual(read.count, 60)
        XCTAssertEqual(Set(read.compactMap { ClaraCaptureQueue.captureId(of: $0) }).count, 60, "cada línea es JSON entero y con su id")
    }

    func testFullQueueRefusesMore() throws {
        let q = queue("a")
        try FileManager.default.createDirectory(at: q.directories[0], withIntermediateDirectories: true)
        let url = q.directories[0].appendingPathComponent(ClaraCaptureQueue.fileName)
        let many = (0..<ClaraCaptureQueue.maxLines).map { "{\"captureId\":\"cap-\($0)\"}\n" }.joined()
        try Data(many.utf8).write(to: url)
        XCTAssertThrowsError(try q.append(try record("cap-extra001"))) { error in
            XCTAssertEqual(error as? ClaraCaptureQueue.QueueError, .full)
        }
    }

    func testBothLocationsAreReadAndCleaned() throws {
        // Primera carpeta = donde se escribe (el App Group); la otra puede tener pagos de antes de activarlo.
        let older = queue("support")
        try older.append(try record("cap-old00001"))
        let q = queue("group", "support")
        try q.append(try record("cap-new00001"))
        let text = try q.readAll()
        XCTAssertTrue(text.contains("cap-old00001") && text.contains("cap-new00001"))
        XCTAssertLessThan(text.range(of: "cap-old00001")!.lowerBound, text.range(of: "cap-new00001")!.lowerBound, "lo que se escribe ahora va al final")
        XCTAssertEqual(try q.remove(ids: ["cap-old00001", "cap-new00001"]), 2)
        XCTAssertEqual(try q.readAll(), "")
    }
}
