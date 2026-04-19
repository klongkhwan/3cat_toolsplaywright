# Playwright 3CAT Extension

VSCode Extension สำหรับจัดช่วยในการเขียน Playwright tests อย่างง่ายดาย พร้อมฟีเจอร์รันเทสจาก Sidebar (Test Explorer), สร้าง Snippets และฟีเจอร์อัดการคลิก (Record Actions) ได้โดยตรงบน VS Code

## 🚀 Features

### 1. 🗂️ Test Explorer (Sidebar) - **NEW!**
แท็บ **3CAT Playwright** ใน Sidebar ช่วยให้คุณจัดการและรันเทสได้อย่างสะดวกสบาย:
- **File Explorer Tree View**: แสดงไฟล์เทสทั้งหมดในรูปแบบโฟลเดอร์ซ้อนกัน (Nested folders) ทำให้อ่านและค้นหาไฟล์ได้ง่ายขึ้น
- **PASS/FAIL Status Indicators**: แสดงผลลัพธ์การรันเทส (✅ PASS หรือ ❌ FAIL) ท้ายชื่อไฟล์ทันทีที่รันเสร็จสิ้น!
- **Unified Run & Options**: เลือกไฟล์จากรายการ, เลือก Project จาก Config และโหมด (Headed/Headless) จากนั้นกดปุ่ม **RUN** เพียงปุ่มเดียว
- **Clean UI**: ซ่อนพาเนลที่ไม่จำเป็นเป็นค่าเริ่มต้นเพื่อให้หน้าตาสะอาดและโฟกัสที่การรันเทส

### 2. 🖱️ Right-click Context Menu
คลิกขวาที่ไฟล์เทสใน File Explorer ปกติ เพื่อรัน Playwright test หรือใช้ตัวเลือกพิเศษได้ทันที

### 3. ✨ Record & Insert
อัดการกระทำใน Browser แล้วให้โค้ดถูกแทรกตรงตำแหน่งเคอร์เซอร์ในไฟล์ `.test.ts` หรือ `.spec.ts`
1. เปิด Recording Tools ใน Sidebar หรือใช้คำสั่ง "Playwright: Record actions and insert code" จาก Command Palette
2. กรอก URL เริ่มต้นที่ต้องการ แล้วกด "Start Recording" หรือเปิด browser เปล่า (about:blank)
3. ปิด recorder เมื่อเสร็จ โค้ดจะแทรกลงในไฟล์ของคุณให้อัตโนมัติ

### 4. 📝 Code Snippets
พิมพ์ snippet เพื่อสร้าง Playwright test code ได้อย่างรวดเร็ว

## 📋 วิธีการใช้งาน

### การรัน Test ผ่าน Sidebar (Test Explorer)
1. ไปที่ไอคอน 3CAT Playwright บน Sidebar
2. เลือกไฟล์เทสที่คุณต้องการรัน จากหน้าต่าง File Tree
3. (ตัวเลือก) เลือก **Playwright Project** (เช่น chromium) หรือปล่อยว่างไว้
4. (ตัวเลือก) เลือกโหมดการทำงาน **Headed** หรือ **Headless** (หรือปล่อยว่างให้ใช้ค่าเริ่มต้น)
5. กดปุ่ม **RUN** 

*(เมื่อรันเสร็จหรือกำลังรัน จะมี Notification แสดงสถานะการรัน)*

### การรัน Test ผ่าน Context Menu (คลิกขวา)
1. เปิด Explorer (Ctrl+Shift+E)
2. คลิกขวาที่ไฟล์ที่มีนามสกุล `.test.ts`, `.spec.ts` ฯลฯ
3. เลือก:
   - **"Run Playwright Test"** - รันแบบ headless ปกติ
   - **"Run Playwright Test (with options)"** - เลือกตัวเลือกพิเศษในการรัน เช่น `debug`, `ui mode`, หรือทำซ้ำ

## 🔧 Code Snippets
พิมพ์ snippet prefix แล้วกด `Tab` เพื่อใช้งาน:
- `3ctest`: สร้างเทมเพลตสำหรับเทสต์พื้นฐานของ Playwright
- `3csteptest`: สร้างขั้นตอนย่อย (`test.step`)
- `3cfulltest`: สร้างเทสต์แบบเต็มรูปแบบ พร้อม `describe`, `beforeEach`, และ `afterEach`
- `3cpomodel`: สร้างคลาส Page Object Model (POM)
- `3cexpect`: สร้างคำสั่งตรวจสอบค่า (expect assertion)
- `3cexport`: สร้างฟังก์ชันและ export
- `3capiresponse`: สร้างคำสั่งตรวจสอบ API 

## 🛠️ วิธีการ Build และติดตั้งเอง (สำหรับนักพัฒนา)

หากต้องการแก้ไขโค้ดหรือทดลอง build ติดตั้งเองในเครื่อง:
1. ติดตั้ง dependencies: `npm install`
2. คอมไพล์โค้ด: `npm run compile`
3. บิลด์เป็นไฟล์ .vsix (ต้องติดตั้ง vsce ก่อน `npm i -g @vscode/vsce`): 
   ```bash
   vsce package
   ```
4. ติดตั้ง .vsix ลงใน VS Code:
   ```bash
   code --install-extension <ชื่อไฟล์ที่ได้>.vsix
   ```

## 🙋‍♂️ Support
หากมีปัญหาหรือข้อเสนอแนะ สามารถสร้าง Issue ได้ที่ GitHub repository