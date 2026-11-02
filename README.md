# MacWallpaperPro

แอปแต่ง macOS เอง: ภาพพื้นหลังเคลื่อนไหวที่ตอบสนองต่อเมาส์, นาฬิกาบนเดสก์ท็อป, ออกจากแอปเมื่อปิดหน้าต่างสุดท้าย, ภาพหน้าจอล็อก (ต้องใช้ macOS 15 ขึ้นไป)

## Build & Run

```bash
./build.sh
open build/MacWallpaperPro.app
```

ไอคอน 🎨 บน menu bar → ตั้งค่า / เปิด-ปิดแต่ละฟีเจอร์

## โครงสร้าง

| ไฟล์ | หน้าที่ |
|---|---|
| `Model.swift` | `Config` (บันทึกใน UserDefaults) |
| `Shaders.swift` | WebGL shader presets + template สำหรับ shader ที่เขียนเอง |
| `Wallpaper.swift` | หน้าต่างระดับ desktop ต่อจอ: shader / วิดีโอ / เว็บ + นาฬิกา + ส่งเคอร์เซอร์เข้าหน้าเว็บ |
| `Wallpapers/nebula/index.html` | wallpaper เริ่มต้น (Nebula Flow) — เปิดในเบราว์เซอร์เพื่อแก้ได้ |
| `TrueQuit.swift` | AXObserver เฝ้า window ทุกแอป → quit เมื่อไม่เหลือหน้าต่าง |
| `SettingsView.swift` | หน้าตั้งค่าแบบ System Settings |

## หมายเหตุ

- **ปิดแอปจริง** ต้องให้สิทธิ์ Accessibility; build ใหม่แต่ละครั้ง (ad-hoc sign) อาจต้องลบแล้วให้สิทธิ์ใหม่
- **Wallpaper HTML ของตัวเอง**: ฟัง `mousemove` / `mousedown` / `click` ตามปกติ — MacWallpaperPro ส่ง event จากเคอร์เซอร์จริงให้ (คลิกส่งเฉพาะเมื่อคลิกบน Desktop) และเรียก `window.setP({c1,c2,c3,speed})` เมื่อเปลี่ยนสีในหน้าตั้งค่า

## License

MacWallpaperPro เป็น open source ภายใต้ [GNU General Public License v3.0](LICENSE)

- ใช้งาน แก้ไข และแจกต่อได้ฟรี รวมถึงใช้ในเชิงพาณิชย์
- ถ้าแจกต่อ (ทั้งแบบแก้ไขหรือไม่แก้ไข) ต้องเปิด source code ภายใต้ GPL-3.0 เหมือนกัน และคงไฟล์ [`NOTICE`](NOTICE) กับ credit "MacWallpaperPro by Amonthep tanlaeo" ไว้
- ชื่อ **MacWallpaperPro** และโลโก้เป็นของผู้สร้าง ไม่อยู่ภายใต้ GPL ถ้าเอาไปดัดแปลงต้องเปลี่ยนชื่อ ดู [TRADEMARKS.md](TRADEMARKS.md)
- wallpaper ใน Community เป็นลิขสิทธิ์ของผู้สร้างแต่ละคน

Copyright © 2026 Amonthep tanlaeo
