// macOS helper for agentshot, the counterpart of win.ps1 (built on first use by lib/platform/mac.mjs).
// Coordinates are points in the global display space (top-left origin), like CGEvent's.
//
//   agentshot-mac windows | screens | perms [--request]
//   agentshot-mac rect --title <title or app> [--activate]
//   agentshot-mac mouselog --out <csv> --stop <file>
//   agentshot-mac drive                                  JSON command per stdin line, JSON reply per line
//   agentshot-mac record (--window <id> | --display <id>) --fps <n> --out <mp4> [--cursor]   "stop" on stdin ends it
//   agentshot-mac snap (--window <id> | --rect x,y,w,h) --out <png>
//
// Needs macOS 14+. Screen Recording permission (window titles, record, snap, waitStill) and
// Accessibility permission (drive, raising windows) go to the app that runs the agent.
import AppKit
import ApplicationServices
import AVFoundation
import CoreMedia
import ImageIO
import ScreenCaptureKit

setvbuf(stdout, nil, _IOLBF, 0)
_ = NSApplication.shared

let args = Array(CommandLine.arguments.dropFirst())
let mode = args.first ?? ""
func opt(_ name: String) -> String? {
  guard let i = args.firstIndex(of: "--" + name), i + 1 < args.count else { return nil }
  return args[i + 1]
}
func flag(_ name: String) -> Bool { args.contains("--" + name) }

func emit(_ obj: Any) {
  let data = try! JSONSerialization.data(withJSONObject: obj, options: [.fragmentsAllowed])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}
func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}
// Runs async work from this synchronous tool and waits for it.
final class ResultBox<T>: @unchecked Sendable { var value: Result<T, Error>? }
func blocking<T>(_ work: @escaping () async throws -> T) throws -> T {
  let sem = DispatchSemaphore(value: 0)
  let box = ResultBox<T>()
  Task.detached {
    do { box.value = .success(try await work()) } catch { box.value = .failure(error) }
    sem.signal()
  }
  sem.wait()
  return try box.value!.get()
}

// MARK: windows and screens

struct Win {
  let id: CGWindowID, pid: pid_t, title: String, owner: String, frame: CGRect, onScreen: Bool
}

func listWindows(includeHidden: Bool = false) -> [Win] {
  let options: CGWindowListOption = includeHidden ? [.excludeDesktopElements] : [.optionOnScreenOnly, .excludeDesktopElements]
  guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return [] }
  return list.compactMap { w in
    guard (w[kCGWindowLayer as String] as? Int) == 0,
      let id = w[kCGWindowNumber as String] as? CGWindowID,
      let pid = w[kCGWindowOwnerPID as String] as? pid_t,
      let bounds = w[kCGWindowBounds as String] as? NSDictionary,
      let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary),
      frame.width >= 80, frame.height >= 60
    else { return nil }
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    // Window titles are only visible with Screen Recording permission; fall back to the app name.
    let title = (w[kCGWindowName as String] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? owner
    return Win(id: id, pid: pid, title: title, owner: owner, frame: frame, onScreen: (w[kCGWindowIsOnscreen as String] as? Bool) ?? false)
  }
}

func displays() -> [CGDirectDisplayID] {
  var ids = [CGDirectDisplayID](repeating: 0, count: 16)
  var n: UInt32 = 0
  CGGetActiveDisplayList(16, &ids, &n)
  return Array(ids.prefix(Int(n)))
}
func displayScale(_ d: CGDirectDisplayID) -> Double {
  guard let m = CGDisplayCopyDisplayMode(d), m.width > 0 else { return 1 }
  return Double(m.pixelWidth) / Double(m.width)
}
func displayAt(_ p: CGPoint) -> CGDirectDisplayID {
  displays().first { CGDisplayBounds($0).contains(p) } ?? CGMainDisplayID()
}

func winJSON(_ w: Win) -> [String: Any] {
  let scale = displayScale(displayAt(CGPoint(x: w.frame.midX, y: w.frame.midY)))
  return [
    "id": Int(w.id), "pid": Int(w.pid), "title": w.title, "process": w.owner,
    "x": Double(w.frame.minX), "y": Double(w.frame.minY), "width": Double(w.frame.width), "height": Double(w.frame.height),
    "scale": scale, "onScreen": w.onScreen,
  ]
}

// Un-minimizes and raises the window through Accessibility, then activates its app.
func raise(_ w: Win) {
  let app = AXUIElementCreateApplication(w.pid)
  var value: CFTypeRef?
  if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success, let wins = value as? [AXUIElement] {
    for ax in wins {
      var t: CFTypeRef?
      AXUIElementCopyAttributeValue(ax, kAXTitleAttribute as CFString, &t)
      if (t as? String) == w.title || wins.count == 1 {
        AXUIElementSetAttributeValue(ax, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
        AXUIElementPerformAction(ax, kAXRaiseAction as CFString)
        break
      }
    }
  }
  NSRunningApplication(processIdentifier: w.pid)?.activate()
}

func findWindow(_ query: String) -> Win? {
  let q = query.lowercased()
  let all = listWindows(includeHidden: true)
  let byTitle = all.filter { $0.title.lowercased().contains(q) }
  let byApp = all.filter { $0.owner.lowercased().contains(q) }
  // visible windows first, then minimized ones
  return (byTitle + byApp).sorted { $0.onScreen && !$1.onScreen }.first
}

// MARK: pixels

func pixels(_ img: CGImage, _ w: Int, _ h: Int) -> [UInt8] {
  var buf = [UInt8](repeating: 0, count: w * h * 4)
  buf.withUnsafeMutableBytes { ptr in
    let ctx = CGContext(
      data: ptr.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  }
  return buf
}
func diff(_ a: [UInt8], _ b: [UInt8]) -> Double {
  var s = 0
  for i in 0..<min(a.count, b.count) { s += abs(Int(a[i]) - Int(b[i])) }
  return Double(s) / Double(max(1, a.count))
}

func shareable() throws -> SCShareableContent {
  try blocking { try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false) }
}
func displayFilter(_ content: SCShareableContent, containing p: CGPoint) -> (SCContentFilter, CGRect)? {
  let id = displayAt(p)
  guard let d = content.displays.first(where: { $0.displayID == id }) ?? content.displays.first else { return nil }
  return (SCContentFilter(display: d, excludingWindows: []), CGDisplayBounds(d.displayID))
}

func writePNG(_ img: CGImage, _ path: String) {
  guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, "public.png" as CFString, 1, nil) else {
    fail("cannot write \(path)")
  }
  CGImageDestinationAddImage(dest, img, nil)
  if !CGImageDestinationFinalize(dest) { fail("cannot write \(path)") }
}

// MARK: input

var buttonDown: CGMouseButton? = nil
func post(_ e: CGEvent?) { e?.post(tap: .cghidEventTap) }
func cursor() -> CGPoint { CGEvent(source: nil)?.location ?? .zero }

func moveCursor(_ p: CGPoint) {
  let type: CGEventType =
    buttonDown == .left ? .leftMouseDragged : buttonDown == .right ? .rightMouseDragged : buttonDown == .center ? .otherMouseDragged : .mouseMoved
  post(CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: buttonDown ?? .left))
}

// Eased glide along a slight arc, like a hand moving a mouse (same curve as win.ps1).
func glide(to target: CGPoint, ms: Double) {
  let p = cursor()
  let dx = target.x - p.x, dy = target.y - p.y
  let len = max(1, (dx * dx + dy * dy).squareRoot()), bow = min(0.08 * len, 40)
  let start = DispatchTime.now().uptimeNanoseconds
  while true {
    let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6
    let k = ms <= 0 ? 1 : min(1, elapsed / ms)
    let e = k < 0.5 ? 4 * k * k * k : 1 - pow(-2 * k + 2, 3) / 2
    let off = sin(Double.pi * e) * bow
    moveCursor(CGPoint(x: p.x + dx * e - dy / len * off, y: p.y + dy * e + dx / len * off))
    if k >= 1 { break }
    usleep(4000)
  }
}

func button(_ name: String?) -> CGMouseButton {
  switch name { case "right": return .right; case "middle": return .center; default: return .left }
}
func press(_ b: CGMouseButton, down: Bool, clickState: Int64 = 1) {
  let type: CGEventType
  switch b {
  case .right: type = down ? .rightMouseDown : .rightMouseUp
  case .center: type = down ? .otherMouseDown : .otherMouseUp
  default: type = down ? .leftMouseDown : .leftMouseUp
  }
  let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: cursor(), mouseButton: b)
  e?.setIntegerValueField(.mouseEventClickState, value: clickState)
  post(e)
  buttonDown = down ? b : nil
}

let namedKeys: [String: CGKeyCode] = [
  "enter": 36, "return": 36, "tab": 48, "space": 49, "backspace": 51, "delete": 117, "del": 117, "esc": 53, "escape": 53,
  "left": 123, "right": 124, "down": 125, "up": 126, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
  "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
]
// ANSI key positions, for shortcuts (cmd+a); text itself goes in as Unicode.
let charKeys: [Character: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
  "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
  "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44,
  "n": 45, "m": 46, ".": 47, "`": 50,
]
let modifiers: [String: CGEventFlags] = [
  "cmd": .maskCommand, "command": .maskCommand, "meta": .maskCommand, "win": .maskCommand, "mod": .maskCommand,
  "ctrl": .maskControl, "control": .maskControl, "alt": .maskAlternate, "option": .maskAlternate, "opt": .maskAlternate,
  "shift": .maskShift,
]

func key(_ combo: String) throws {
  var flags: CGEventFlags = []
  var code: CGKeyCode? = nil
  for part in combo.lowercased().split(separator: "+").map(String.init) {
    if let m = modifiers[part] { flags.insert(m) }
    else if let k = namedKeys[part] { code = k }
    else if part.count == 1, let k = charKeys[Character(part)] { code = k }
    else { throw NSError(domain: "shot", code: 1, userInfo: [NSLocalizedDescriptionKey: "unknown key '\(part)'"]) }
  }
  guard let c = code else { throw NSError(domain: "shot", code: 1, userInfo: [NSLocalizedDescriptionKey: "no key in '\(combo)'"]) }
  for (down, delay) in [(true, 40_000), (false, 0)] {
    let e = CGEvent(keyboardEventSource: nil, virtualKey: c, keyDown: down)
    e?.flags = flags
    post(e)
    usleep(useconds_t(delay))
  }
}

func typeText(_ text: String, cps: Double) {
  let gap = useconds_t(1_000_000 / max(1, cps))
  for ch in text {
    if ch == "\n" { try? key("enter") } else {
      let units = Array(String(ch).utf16)
      for down in [true, false] {
        let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
        e?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        post(e)
      }
    }
    usleep(gap)
  }
}

// Small thumbnails of a screen rect, for "has it changed / settled" checks.
final class Watcher {
  let filter: SCContentFilter
  let config = SCStreamConfiguration()
  init(rect: CGRect) throws {
    let content = try shareable()
    guard let found = displayFilter(content, containing: CGPoint(x: rect.midX, y: rect.midY)) else {
      throw NSError(domain: "shot", code: 2, userInfo: [NSLocalizedDescriptionKey: "no display"])
    }
    let (f, db) = found
    filter = f
    config.sourceRect = CGRect(x: rect.minX - db.minX, y: rect.minY - db.minY, width: rect.width, height: rect.height)
    config.width = 96
    config.height = 60
    config.showsCursor = false
  }
  func thumb() throws -> [UInt8] {
    let f = filter, c = config
    let img = try blocking { try await SCScreenshotManager.captureImage(contentFilter: f, configuration: c) }
    return pixels(img, 96, 60)
  }
}

func num(_ c: [String: Any], _ k: String, _ d: Double = 0) -> Double { (c[k] as? NSNumber)?.doubleValue ?? d }

func drive() {
  emit(["ready": true])
  while let line = readLine() {
    if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
    guard let data = line.data(using: .utf8), let c = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      emit(["ok": false, "error": "bad json"]); continue
    }
    var reply: [String: Any] = ["ok": true]
    do {
      switch c["op"] as? String ?? "" {
      case "move": glide(to: CGPoint(x: num(c, "x"), y: num(c, "y")), ms: num(c, "ms"))
      case "down": press(button(c["button"] as? String), down: true)
      case "up": press(button(c["button"] as? String), down: false)
      case "click":
        let b = button(c["button"] as? String)
        for i in 0..<max(1, Int(num(c, "count", 1))) {
          press(b, down: true, clickState: Int64(i + 1)); usleep(70_000)
          press(b, down: false, clickState: Int64(i + 1)); usleep(60_000)
        }
      case "wheel":
        let n = Int(num(c, "notches"))
        for _ in 0..<abs(n) {
          // positive notches scroll down, three lines each like a Windows wheel notch
          post(CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: Int32(n > 0 ? -3 : 3), wheel2: 0, wheel3: 0))
          usleep(110_000)
        }
      case "text": typeText(c["text"] as? String ?? "", cps: num(c, "cps", 14))
      case "key": try key(c["combo"] as? String ?? "")
      case "still":
        // Optionally wait for a change from how it looked at the start, then for `quiet` ms of calm.
        let w = try Watcher(rect: CGRect(x: num(c, "x"), y: num(c, "y"), width: num(c, "w"), height: num(c, "h")))
        let start = DispatchTime.now().uptimeNanoseconds
        let elapsed = { Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6 }
        var prev = try w.thumb()
        let base = prev
        reply["changed"] = false
        if num(c, "change") > 0 {
          while elapsed() < num(c, "changeTimeout", 3000) {
            usleep(60_000)
            prev = try w.thumb()
            if diff(base, prev) > num(c, "change") { reply["changed"] = true; break }
          }
        }
        var calmSince = elapsed()
        reply["settled"] = false
        while elapsed() < num(c, "timeout", 8000) {
          usleep(90_000)
          let cur = try w.thumb()
          if diff(prev, cur) > num(c, "threshold", 0.6) { calmSince = elapsed() }
          prev = cur
          if elapsed() - calmSince >= num(c, "quiet", 500) { reply["settled"] = true; break }
        }
        reply["waited"] = Int(elapsed())
      default: throw NSError(domain: "shot", code: 3, userInfo: [NSLocalizedDescriptionKey: "unknown op '\(c["op"] ?? "")'"])
      }
    } catch {
      reply = ["ok": false, "error": error.localizedDescription]
    }
    emit(reply)
  }
}

// MARK: recording

// Writes ScreenCaptureKit frames to an H.264 MP4. ScreenCaptureKit only delivers a frame when the
// content changes, so the file is variable frame rate; the last frame is repeated at stop time so
// the video lasts as long as the recording. mac.mjs re-encodes it to constant fps.
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
  let writer: AVAssetWriter
  let input: AVAssetWriterInput
  let adaptor: AVAssetWriterInputPixelBufferAdaptor
  let lock = NSLock()
  var started = false
  var last: (CVPixelBuffer, CMTime)? = nil
  var frames = 0

  init(url: URL, width: Int, height: Int, fps: Int) throws {
    try? FileManager.default.removeItem(at: url)
    writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: max(10_000_000, width * height * fps / 5),
          AVVideoExpectedSourceFrameRateKey: fps, AVVideoMaxKeyFrameIntervalKey: fps,
        ],
      ])
    input.expectsMediaDataInRealTime = true
    adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
    writer.add(input)
    writer.startWriting()
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, sb.isValid,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
      let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
      let pb = CMSampleBufferGetImageBuffer(sb)
    else { return }
    let pts = CMSampleBufferGetPresentationTimeStamp(sb)
    lock.lock()
    defer { lock.unlock() }
    if !started {
      writer.startSession(atSourceTime: pts)
      started = true
      // Frame times are on the host clock: wall time of this frame = now - its age.
      let age = CMTimeGetSeconds(CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), pts))
      emit(["started": Date().timeIntervalSince1970 * 1000 - age * 1000])
    }
    if input.isReadyForMoreMediaData, adaptor.append(pb, withPresentationTime: pts) { frames += 1 }
    last = (pb, pts)
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) { fail("recording stopped: \(error.localizedDescription)") }

  func finish(_ done: @escaping () -> Void) {
    lock.lock()
    guard started, let lastFrame = last else { lock.unlock(); fail("no frames were captured (is the window on screen?)") }
    let (pb, pts) = lastFrame
    let end = CMClockGetTime(CMClockGetHostTimeClock())
    if CMTimeCompare(end, pts) > 0, input.isReadyForMoreMediaData { adaptor.append(pb, withPresentationTime: end) }
    input.markAsFinished()
    writer.endSession(atSourceTime: CMTimeCompare(end, pts) > 0 ? end : pts)
    lock.unlock()
    writer.finishWriting(completionHandler: done)
  }
}

func record() {
  let fps = Int(opt("fps") ?? "60") ?? 60
  guard let out = opt("out") else { fail("--out is required") }
  Task.detached {
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
      let filter: SCContentFilter
      if let id = opt("window").flatMap({ UInt32($0) }) {
        guard let w = content.windows.first(where: { $0.windowID == id }) else { fail("window \(id) not found") }
        filter = SCContentFilter(desktopIndependentWindow: w)
      } else {
        let id = opt("display").flatMap { UInt32($0) } ?? CGMainDisplayID()
        guard let d = content.displays.first(where: { $0.displayID == id }) else { fail("display \(id) not found") }
        filter = SCContentFilter(display: d, excludingWindows: [])
      }
      let scale = Double(filter.pointPixelScale)
      let width = Int((Double(filter.contentRect.width) * scale).rounded()) & ~1
      let height = Int((Double(filter.contentRect.height) * scale).rounded()) & ~1
      let config = SCStreamConfiguration()
      config.width = width
      config.height = height
      config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
      config.showsCursor = flag("cursor")  // only for sync checks; the renderer draws the cursor
      config.pixelFormat = kCVPixelFormatType_32BGRA
      config.queueDepth = 8
      config.capturesAudio = false
      config.ignoreShadowsSingleWindow = true
      config.captureResolution = .best
      let rec = try Recorder(url: URL(fileURLWithPath: out), width: width, height: height, fps: fps)
      let stream = SCStream(filter: filter, configuration: config, delegate: rec)
      try stream.addStreamOutput(rec, type: .screen, sampleHandlerQueue: DispatchQueue(label: "agentshot.frames"))
      try await stream.startCapture()
      DispatchQueue.global().async {
        while let l = readLine(), l.trimmingCharacters(in: .whitespaces) != "stop" {}
        Task.detached {
          try? await stream.stopCapture()
          rec.finish {
            emit(["done": true, "frames": rec.frames, "width": width, "height": height, "scale": scale])
            exit(0)
          }
        }
      }
    } catch {
      fail("record: \(error.localizedDescription)")
    }
  }
  dispatchMain()
}

func snap() {
  guard let out = opt("out") else { fail("--out is required") }
  do {
    let content = try shareable()
    let filter: SCContentFilter
    let config = SCStreamConfiguration()
    config.showsCursor = false
    config.captureResolution = .best
    config.ignoreShadowsSingleWindow = true
    if let id = opt("window").flatMap({ UInt32($0) }) {
      guard let w = content.windows.first(where: { $0.windowID == id }) else { fail("window \(id) not found") }
      filter = SCContentFilter(desktopIndependentWindow: w)
    } else if let r = opt("rect")?.split(separator: ",").compactMap({ Double($0) }), r.count == 4 {
      let rect = CGRect(x: r[0], y: r[1], width: r[2], height: r[3])
      guard let found = displayFilter(content, containing: CGPoint(x: rect.midX, y: rect.midY)) else { fail("no display") }
      let (f, db) = found
      filter = f
      config.sourceRect = CGRect(x: rect.minX - db.minX, y: rect.minY - db.minY, width: rect.width, height: rect.height)
      config.width = Int(rect.width * Double(f.pointPixelScale))
      config.height = Int(rect.height * Double(f.pointPixelScale))
    } else { fail("--window <id> or --rect x,y,w,h is required") }
    if opt("window") != nil {
      let scale = Double(filter.pointPixelScale)
      config.width = Int((Double(filter.contentRect.width) * scale).rounded()) & ~1
      config.height = Int((Double(filter.contentRect.height) * scale).rounded()) & ~1
    }
    let f = filter, c = config
    let img = try blocking { try await SCScreenshotManager.captureImage(contentFilter: f, configuration: c) }
    writePNG(img, out)
    emit(["file": out, "width": img.width, "height": img.height])
  } catch {
    fail("snap: \(error.localizedDescription)")
  }
}

// MARK: main

switch mode {
case "windows":
  emit(listWindows().map(winJSON))
case "screens":
  let main = CGMainDisplayID()
  emit(displays().enumerated().map { i, d in
    let b = CGDisplayBounds(d)
    return ["index": i, "id": Int(d), "primary": d == main, "x": Double(b.minX), "y": Double(b.minY),
            "width": Double(b.width), "height": Double(b.height), "scale": displayScale(d)] as [String: Any]
  })
case "perms":
  if flag("request") {
    _ = CGRequestScreenCaptureAccess()
    _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
  }
  emit(["screenRecording": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted()])
case "rect":
  guard let q = opt("title"), var w = findWindow(q) else { emit(NSNull()); exit(0) }
  if flag("activate") || !w.onScreen {
    raise(w)
    usleep(450_000)
    if let again = listWindows(includeHidden: true).first(where: { $0.id == w.id }) { w = again }
  }
  emit(winJSON(w))
case "mouselog":
  guard let outPath = opt("out"), let stopPath = opt("stop") else { fail("--out and --stop are required") }
  FileManager.default.createFile(atPath: outPath, contents: nil)
  guard let fh = FileHandle(forWritingAtPath: outPath) else { fail("cannot write \(outPath)") }
  fh.write("start,\(Int64(Date().timeIntervalSince1970 * 1000))\n".data(using: .utf8)!)
  let t0 = DispatchTime.now().uptimeNanoseconds
  var buf = ""
  var n = 0
  while !FileManager.default.fileExists(atPath: stopPath) {
    let p = cursor()
    let down = CGEventSource.buttonState(.combinedSessionState, button: .left) ? 1 : 0
    let ms = (DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000
    buf += "\(ms),\(String(format: "%.1f", p.x)),\(String(format: "%.1f", p.y)),\(down)\n"
    n += 1
    if n % 60 == 0 { fh.write(buf.data(using: .utf8)!); buf = "" }
    usleep(8000)
  }
  fh.write(buf.data(using: .utf8)!)
  fh.closeFile()
case "drive":
  drive()
case "record":
  record()
case "snap":
  snap()
default:
  fail("unknown mode '\(mode)'; see the header of recorder/mac.swift")
}
