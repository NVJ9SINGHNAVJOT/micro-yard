import SwiftUI

// Lightweight filled-area sparkline drawn with Canvas/Path — no Swift Charts,
// no animation timer. Redraws only when `values` changes.
struct Sparkline: View {
    let values: [Double]
    var maxValue: Double = 100
    var color: Color = .accentColor

    var body: some View {
        Canvas { ctx, size in
            guard values.count >= 2 else { return }
            let maxV = max(maxValue, 0.0001)
            let stepX = size.width / CGFloat(values.count - 1)

            func point(_ i: Int) -> CGPoint {
                let clamped = min(max(values[i], 0), maxV)
                let y = size.height - CGFloat(clamped / maxV) * size.height
                return CGPoint(x: CGFloat(i) * stepX, y: y)
            }

            // Filled area under the line.
            var fill = Path()
            fill.move(to: CGPoint(x: 0, y: size.height))
            for i in values.indices { fill.addLine(to: point(i)) }
            fill.addLine(to: CGPoint(x: size.width, y: size.height))
            fill.closeSubpath()
            ctx.fill(fill, with: .color(color.opacity(0.18)))

            // The line itself.
            var line = Path()
            line.move(to: point(0))
            for i in values.indices.dropFirst() { line.addLine(to: point(i)) }
            ctx.stroke(line, with: .color(color), lineWidth: 1.5)
        }
    }
}
