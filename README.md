# 🔍 Real-time Video Fact-Check Overlay

Chrome Extension ที่แสดงหน้าต่างโปร่งใสทับวิดีโอ YouTube เพื่อแสดงข้อมูล Fact-check, Context และ Live Poll แบบเรียลไทม์

## 📁 โครงสร้างโปรเจกต์

```
/workspace
├── manifest.json                    # Chrome Extension Manifest V3
├── src/
│   ├── background/
│   │   └── service-worker.js        # OAuth, Authentication, Message Routing
│   ├── content/
│   │   └── overlay.js               # Transparent Overlay UI
│   └── popup/
│       ├── popup.html               # Settings Popup UI
│       └── popup.js                 # Popup Logic
└── assets/
    ├── icon16.png                   # (ต้องสร้างเอง)
    ├── icon48.png                   # (ต้องสร้างเอง)
    └── icon128.png                  # (ต้องสร้างเอง)
```

## 🚀 การติดตั้งและใช้งาน

### ขั้นตอนที่ 1: ตั้งค่า Google OAuth

1. **สร้างโปรเจกต์ใน Google Cloud Console**
   - ไปที่ https://console.cloud.google.com/
   - สร้างโปรเจกต์ใหม่ (เช่น `FactCheck-Extension`)

2. **เปิดใช้งาน API**
   - ไปที่ **APIs & Services > Library**
   - ค้นหาและเปิดใช้งาน **People API** (ใช้ดึงข้อมูลผู้ใช้)
   - **หมายเหตุ:** Chrome Identity API ไม่ต้องเปิดใช้งาน (เป็น built-in permission)

3. **ตั้งค่า OAuth Consent Screen**
   - ไปที่ **APIs & Services > OAuth consent screen**
   - เลือก **External**
   - กรอกข้อมูล:
     - App name: `Fact-Check Overlay`
     - User support email: อีเมลของคุณ
     - Developer contact: อีเมลของคุณ
   - กด **SAVE AND CONTINUE**
   - ในหน้า **Scopes**:
     - คลิก **+ ADD OR REMOVE SCOPES**
     - เลือก: `openid`, `userinfo.email`, `userinfo.profile`
     - กด **UPDATE** แล้ว **SAVE AND CONTINUE**
   - ในหน้า **Test users**:
     - คลิก **+ ADD USERS**
     - เพิ่มอีเมลของคุณ (จำเป็นในช่วงพัฒนา)
     - กด **SAVE AND CONTINUE**

4. **สร้าง OAuth Client ID**
   - ไปที่ **APIs & Services > Credentials**
   - คลิก **Create Credentials > OAuth client ID**
   - เลือก **Chrome App** (สำคัญมาก! ไม่ใช่ Web Application)
   - ตั้งชื่อ: `Fact-Check Extension`
   - ในช่อง **Allowed origins** ใส่ค่าชั่วคราวก่อน: `https://placeholder.chromiumapp.org`
   - กด **CREATE**
   - **คัดลอก Client ID** ที่ได้รับ (จะลงท้ายด้วย `.apps.googleusercontent.com`)

5. **โหลด Extension เพื่อหา Extension ID**
   - เปิด Chrome ไปที่ `chrome://extensions/`
   - เปิดมุมขวาบน **Developer mode**
   - คลิก **Load unpacked**
   - เลือกโฟลเดอร์ `/workspace`
   - **คัดลอก Extension ID** ที่ปรากฏ (จะเป็นตัวอักษรแบบ `abcdefghijklmnopqrstuvwxyz123456`)

6. **อัปเดต Allowed Origins**
   - กลับไป Google Cloud Console > Credentials
   - คลิกแก้ไข OAuth Client ID ที่สร้างไว้
   - เปลี่ยน **Allowed origins** เป็น:
     ```
     https://[YOUR_EXTENSION_ID].chromiumapp.org
     ```
     (แทน `[YOUR_EXTENSION_ID]` ด้วย ID ที่ได้จากขั้นตอน 5)
   - กด **SAVE**

7. **ใส่ Client ID ในโค้ด**
   - เปิดไฟล์ `manifest.json` แก้ไขบรรทัด:
     ```json
     "oauth2": {
       "client_id": "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
       ...
     }
     ```
   - เปิดไฟล์ `src/background/service-worker.js` แก้ไขบรรทัด:
     ```javascript
     const clientId = 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com';
     ```

### ขั้นตอนที่ 2: สร้าง Icon Files (Optional แต่แนะนำ)

สร้างไฟล์ PNG ขนาดต่างๆ ในโฟลเดอร์ `assets/`:
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)  
- `icon128.png` (128x128 pixels)

หรือใช้ temporary icons โดยสร้างไฟล์ SVG แปลงเป็น PNG จากเว็บเช่น https://favicon.io/

### ขั้นตอนที่ 3: โหลด Extension

1. เปิด Chrome ไปที่ `chrome://extensions/`
2. เปิด **Developer mode** (มุมขวาบน)
3. คลิก **Load unpacked**
4. เลือกโฟลเดอร์ `/workspace`
5. Extension จะปรากฏในรายการ

### ขั้นตอนที่ 4: ทดสอบ

1. เปิด YouTube (https://www.youtube.com/)
2. เปิดวิดีโอใดๆ
3. คุณจะเห็นหน้าต่าง Overlay ลอยอยู่ด้านข้าง
4. ลองลาก ย่อ/ขยาย หรือปิดหน้าต่าง
5. คลิกที่ไอคอน Extension ใน toolbar เพื่อเปิด Settings
6. กด **Login with Google** (ถ้าตั้งค่า OAuth ถูกต้อง)

## 🎯 ฟีเจอร์ที่ใช้งานได้ (Phase 1)

- ✅ Transparent Overlay ลอยทับ YouTube Player
- ✅ ลาก ย้ายตำแหน่งได้
- ✅ ย่อ/ขยายขนาดได้ (drag จากมุมซ้ายบน)
- ✅ ซ่อน/แสดงหน้าต่าง (ปุ่ม X)
- ✅ Minimize (ปุ่ม −)
- ✅ จำตำแหน่งและขนาดอัตโนมัติ (LocalStorage)
- ✅ ปรับขนาดตามวิดีโออัตโนมัติ (ResizeObserver)
- ✅ Popup Settings UI สวยงาม
- ✅ Guest Mode Support
- ✅ โครงสร้างพร้อมสำหรับ Google OAuth

## ⚙️ การตั้งค่าที่ต้องทำต่อ (Phase 2-5)

### Phase 2: Authentication & Data Extraction
- [ ] เชื่อมต่อ Firebase Authentication
- [ ] ดึง YouTube Transcript
- [ ] แมปเวลากับข้อความ

### Phase 3: Backend & AI
- [ ] สร้าง Node.js/Python Backend
- [ ] เชื่อมต่อ Vector DB (Pinecone/Supabase)
- [ ] ตั้งค่า OpenAI/Gemini API
- [ ] ทำ RAG System

### Phase 4: Real-time Sync
- [ ] ติดตั้ง Socket.io + Redis
- [ ] ทำระบบ Broadcast (1:N)
- [ ] Latecomer State Management

### Phase 5: Facebook & Scaling
- [ ] รองรับ Facebook Video
- [ ] Semantic Caching
- [ ] Triage System สำหรับ 100k users

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Extension:** Manifest V3
- **Backend (Phase 3):** Node.js (Express) หรือ Python (FastAPI)
- **Real-time:** Socket.io + Redis Pub/Sub
- **Database:** Firestore + Vector DB (Pinecone/Supabase)
- **AI:** OpenAI API / Gemini API
- **Auth:** Firebase Authentication + Google OAuth

## 📝 หมายเหตุสำคัญ

1. **OAuth ต้องใช้ Chrome App** ไม่ใช่ Web Application
2. **ต้องเพิ่มอีเมลใน Test Users** ไม่งั้น Login ไม่ได้ในช่วงพัฒนา
3. **Extension ID จะเปลี่ยน** ถ้าโหลดใหม่ในโหมด Incognito หรือเครื่องอื่น
4. **Firebase Config** ต้องใส่ใน `service-worker.js` เมื่อพร้อมใช้

## 🐛 Troubleshooting

### Login ปุ่มไม่ทำงาน
- ตรวจสอบว่าใส่ Client ID ถูกต้องใน `manifest.json` และ `service-worker.js`
- ตรวจสอบว่า Allowed origins ตรงกับ Extension ID
- ตรวจสอบว่ามีอีเมลใน Test Users

### Overlay ไม่ขึ้น
- ตรวจสอบว่าเปิด YouTube ผ่าน `https://www.youtube.com/` (ไม่ใช่ `http`)
- ดู Console Log (F12 > Console) เพื่อหา error

### Icon ไม่แสดง
- สร้างไฟล์ PNG ในโฟลเดอร์ `assets/` หรือ comment ส่วน `icons` ใน `manifest.json` ชั่วคราว

## 📄 License

MIT License - พัฒนาเพื่อการศึกษาและใช้งานจริง

---

**พัฒนาโดย:** Senior Full-Stack Developer & System Architect  
**เวอร์ชัน:** 0.1.0 (Phase 1 Complete)  
**อัปเดตล่าสุด:** 2024