// Draws the app icon (vector) and builds Resources/AppIcon.icns
//   swift scripts/make-icon.swift
import AppKit

func render(_ px: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(px), pixelsHigh: Int(px), bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext
    let s = px / 1024
    ctx.scaleBy(x: s, y: s)

    // macOS icon grid: 824×824 squircle centered in 1024 canvas
    let box = CGRect(x: 100, y: 100, width: 824, height: 824)
    let shape = CGPath(roundedRect: box, cornerWidth: 185, cornerHeight: 185, transform: nil)

    // drop shadow
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: NSColor.black.withAlphaComponent(0.35).cgColor)
    ctx.addPath(shape); ctx.setFillColor(NSColor.black.cgColor); ctx.fillPath()
    ctx.restoreGState()

    ctx.saveGState()
    ctx.addPath(shape); ctx.clip()
    let cs = CGColorSpaceCreateDeviceRGB()
    func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
        CGColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
    }
    // base: deep night → violet → pink
    let base = CGGradient(colorsSpace: cs, colors: [color(0x120A2E), color(0x5B21B6), color(0xDB2777)] as CFArray, locations: [0, 0.55, 1])!
    ctx.drawLinearGradient(base, start: CGPoint(x: 100, y: 924), end: CGPoint(x: 924, y: 100), options: [])
    // nebula glows
    for (c, x, y, r, a) in [(0x22D3EE, 330.0, 690.0, 420.0, 0.55), (0xF472B6, 760.0, 300.0, 380.0, 0.5), (0xA78BFA, 560.0, 520.0, 300.0, 0.35)] {
        let g = CGGradient(colorsSpace: cs, colors: [color(UInt32(c), a), color(UInt32(c), 0)] as CFArray, locations: [0, 1])!
        ctx.drawRadialGradient(g, startCenter: CGPoint(x: x, y: y), startRadius: 0, endCenter: CGPoint(x: x, y: y), endRadius: r, options: [])
    }
    // stars
    var seed: UInt64 = 7
    func rnd() -> CGFloat { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return CGFloat(seed >> 33) / CGFloat(UInt32.max >> 1) }
    for _ in 0..<70 {
        let x = 110 + rnd() * 800, y = 110 + rnd() * 800, r = 1.5 + rnd() * 3.5
        ctx.setFillColor(NSColor.white.withAlphaComponent(0.25 + rnd() * 0.5).cgColor)
        ctx.fillEllipse(in: CGRect(x: x, y: y, width: r, height: r))
    }

    // glyph: display with flowing wave + sparkle
    let screen = CGRect(x: 262, y: 360, width: 500, height: 330)
    let screenPath = CGPath(roundedRect: screen, cornerWidth: 46, cornerHeight: 46, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 30, color: NSColor.black.withAlphaComponent(0.35).cgColor)
    ctx.addPath(screenPath); ctx.setFillColor(NSColor.white.withAlphaComponent(0.16).cgColor); ctx.fillPath()
    ctx.restoreGState()
    ctx.addPath(screenPath); ctx.setStrokeColor(NSColor.white.cgColor); ctx.setLineWidth(30); ctx.strokePath()

    // wave inside screen
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: screen.insetBy(dx: 15, dy: 15), cornerWidth: 32, cornerHeight: 32, transform: nil)); ctx.clip()
    let wave = CGMutablePath()
    wave.move(to: CGPoint(x: 250, y: 470))
    wave.addCurve(to: CGPoint(x: 510, y: 500), control1: CGPoint(x: 330, y: 600), control2: CGPoint(x: 420, y: 380))
    wave.addCurve(to: CGPoint(x: 780, y: 560), control1: CGPoint(x: 600, y: 620), control2: CGPoint(x: 690, y: 450))
    wave.addLine(to: CGPoint(x: 780, y: 340)); wave.addLine(to: CGPoint(x: 250, y: 340)); wave.closeSubpath()
    ctx.addPath(wave); ctx.clip()
    let wg = CGGradient(colorsSpace: cs, colors: [NSColor.white.withAlphaComponent(0.95).cgColor, NSColor.white.withAlphaComponent(0.55).cgColor] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(wg, start: CGPoint(x: 0, y: 600), end: CGPoint(x: 0, y: 360), options: [])
    ctx.restoreGState()

    // stand
    ctx.setFillColor(NSColor.white.cgColor)
    ctx.addPath(CGPath(roundedRect: CGRect(x: 487, y: 288, width: 50, height: 70), cornerWidth: 10, cornerHeight: 10, transform: nil)); ctx.fillPath()
    ctx.addPath(CGPath(roundedRect: CGRect(x: 392, y: 262, width: 240, height: 36), cornerWidth: 18, cornerHeight: 18, transform: nil)); ctx.fillPath()

    // sparkle (4-point star) top-right
    func sparkle(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) {
        let p = CGMutablePath()
        p.move(to: CGPoint(x: cx, y: cy + r))
        p.addQuadCurve(to: CGPoint(x: cx + r, y: cy), control: CGPoint(x: cx + r * 0.18, y: cy + r * 0.18))
        p.addQuadCurve(to: CGPoint(x: cx, y: cy - r), control: CGPoint(x: cx + r * 0.18, y: cy - r * 0.18))
        p.addQuadCurve(to: CGPoint(x: cx - r, y: cy), control: CGPoint(x: cx - r * 0.18, y: cy - r * 0.18))
        p.addQuadCurve(to: CGPoint(x: cx, y: cy + r), control: CGPoint(x: cx - r * 0.18, y: cy + r * 0.18))
        ctx.saveGState()
        ctx.setShadow(offset: .zero, blur: 24, color: NSColor.white.withAlphaComponent(0.9).cgColor)
        ctx.addPath(p); ctx.setFillColor(NSColor.white.cgColor); ctx.fillPath()
        ctx.restoreGState()
    }
    sparkle(735, 735, 78)
    sparkle(640, 790, 30)

    // top gloss
    let gloss = CGGradient(colorsSpace: cs, colors: [NSColor.white.withAlphaComponent(0.18).cgColor, NSColor.white.withAlphaComponent(0).cgColor] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(gloss, start: CGPoint(x: 0, y: 924), end: CGPoint(x: 0, y: 600), options: [])
    ctx.restoreGState()

    // hairline edge
    ctx.addPath(shape); ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.18).cgColor); ctx.setLineWidth(3); ctx.strokePath()

    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
let iconset = root.appendingPathComponent("Resources/AppIcon.iconset")
try? FileManager.default.removeItem(at: iconset)
try! FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(size)x\(size).png" : "icon_\(size)x\(size)@2x.png"
        try! render(CGFloat(size * scale)).representation(using: .png, properties: [:])!.write(to: iconset.appendingPathComponent(name))
    }
}
try! render(1024).representation(using: .png, properties: [:])!.write(to: root.appendingPathComponent("Resources/AppIcon-1024.png"))
print("iconset written")
