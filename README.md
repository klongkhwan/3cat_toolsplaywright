# Playwright 3CAT Extension

VSCode Extension สำหรับจัดช่วยในการเขียน Playwright tests อย่างง่ายดาย พร้อมฟีเจอร์รันเทสและอัดการคลิกได้โดยตรงบน VS Code

![Extension Demo](./images/demo.gif)

## 🚀 Features

### 1. Right-click Context Menu
คลิกขวาที่ไฟล์ test เพื่อรัน Playwright test ได้ทันที

### 2. Multiple Run Options
เลือกวิธีการรันที่เหมาะสมกับการทดสอบของคุณ

### 3. Code Snippets
พิมพ์ snippet เพื่อสร้าง Playwright test code ได้อย่างรวดเร็ว

### 4. Record & Insert (✨ ฟีเจอร์ใหม่)
อัดการคลิกใน browser แล้วให้โค้ดที่ได้ถูกแทรกตรงตำแหน่งเคอร์เซอร์ในไฟล์ .test.ts หรือ .spec.ts
ใช้คำสั่ง "Playwright: Record actions and insert code" จาก context menu หรือ Command Palette
จะเปิด browser เปล่า ๆ (about:blank) ให้คุณพิมพ์ URL เอง
หลังจากอัดและปิด recorder → โค้ดที่ได้จะถูกแทรกในไฟล์ให้อัตโนมัติ

## 📋 วิธีการใช้งาน
### การรัน Test

#### 🖱️ คลิกขวาที่ไฟล์
1. เปิด Explorer (Ctrl+Shift+E)
2. คลิกขวาที่ไฟล์ที่มีนามสกุล `.test.ts`, `.test.js`, `.spec.ts`, หรือ `.spec.js`
3. เลือก:
   - **"Run Playwright Test"** - รันแบบ headless ปกติ
   - **"Run Playwright Test (with options)"** - เลือกตัวเลือกการรัน

### ตัวเลือกการรัน

| ตัวเลือก | คำสั่งที่ถูกสร้าง | คำอธิบาย |
|---------|-----------------|---------|
| **Run headless (normal)** | `--headed=false` | รันแบบ headless (ไม่แสดงหน้าต่างบราวเซอร์) |
| **Run with headed browser** | `--headed` | รันโดยแสดงหน้าต่างบราวเซอร์ |
| **Run loop 3 times** | `--repeat-each=3 --workers=1` | รันซ้ำ 3 รอบแบบ sequential |
| **Run with debug** | `--debug` | รันในโหมด debug |
| **Run with specific browser** | `--project=chromium` | รันเฉพาะ Chromium |
| **Run with UI mode** | `--ui` | รันแบบ UI mode |


## 🔧 Code Snippets
พิมพ์ snippet prefix แล้วกด `Tab` เพื่อใช้งาน:

🔹 key: 3ctest
Description: สร้างเทมเพลตสำหรับเทสต์พื้นฐานของ Playwright

🔹 key: 3csteptest
Description: สร้างขั้นตอนย่อย (test.step) ในการทดสอบ

🔹 key: 3cfulltest
Description: สร้างเทสต์แบบเต็มรูปแบบของ Playwright พร้อม describe, beforeEach, และ afterEach

🔹 key: 3cpomodel
Description: สร้างคลาส Page Object Model (POM) สำหรับจัดการ element ต่าง ๆ

🔹 key: 3cexpect
Description: สร้างคำสั่งตรวจสอบค่า (expect assertion) เช่น การมองเห็น, ข้อความ, การเลือก

🔹 key: 3cexport
Description: สร้างฟังก์ชันและ export สำหรับใช้งานกับ Playwright

🔹 key: 3capiresponse
Description: สร้างคำสั่งตรวจสอบ API 

## 🙋‍♂️ Support

หากมีปัญหาหรือข้อเสนอแนะ สามารถสร้าง Issue ได้ที่ GitHub repository