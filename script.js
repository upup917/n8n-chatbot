// --- CONFIGURATION ---
const CONFIG = {
    // ⚠️ อย่าลืมเช็ค URL นี้ให้ตรงกับ Tunnel ล่าสุดของคุณ
    WEBHOOK_URL: 'http://localhost:5678/webhook-test/21c6544a-7af4-4b9b-ab08-6ab41456a75d',
    CHAT_INPUT_KEY: 'chatInput',
    TRIGGER_KEY: 'trigger',
    RESPONSE_KEY: 'output',
    SESSION_TIMEOUT_MS: 15 * 60 * 1000 
};

// --- DOM ELEMENTS ---
const elements = {
    chatWrapper: document.getElementById('chat-wrapper'),
    chatContainer: document.getElementById('chat-container'),
    userInput: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    endChatBtn: document.getElementById('end-chat-btn'),
    quickReplies: document.getElementById('quick-replies')
};

// --- EVENT LISTENERS ---
elements.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleInputSubmit();
});
elements.sendBtn.addEventListener('click', handleInputSubmit);
elements.endChatBtn.addEventListener('click', resetChat);

// --- FUNCTIONS ---

// ฟังก์ชันจัดการ Session ID (แบบรันเลข s1, s2, s3...)
function getChatMetadata() {
    // 1. จัดการ User ID
    let userId = localStorage.getItem('rpa_user_id');
    if (!userId) {
        // สร้าง User ID แบบสั้นๆ (เช่น u_lz4f2x)
        userId = 'u_' + Date.now().toString(36);
        localStorage.setItem('rpa_user_id', userId);
    }

    // 2. จัดการ Session ID
    let sessionId = localStorage.getItem('rpa_session_id');
    const lastActive = parseInt(localStorage.getItem('rpa_last_active') || '0');
    const now = Date.now();

    // ถ้ายังไม่มี Session หรือหมดเวลา -> สร้างใหม่โดยการนับเลขเพิ่ม
    if (!sessionId || (now - lastActive > CONFIG.SESSION_TIMEOUT_MS)) {
        // ดึงตัวนับล่าสุดมา (ถ้าไม่มีให้เริ่มที่ 0)
        let currentCount = parseInt(localStorage.getItem('rpa_session_count') || '0');
        
        // บวกเพิ่ม 1
        currentCount++; 
        
        // สร้าง ID ใหม่: s1, s2, s3...
        sessionId = 's' + currentCount; 

        // บันทึกค่าใหม่ลงเครื่อง
        localStorage.setItem('rpa_session_count', currentCount);
        localStorage.setItem('rpa_session_id', sessionId);
        
        console.log("New Session Generated:", sessionId);
    }

    localStorage.setItem('rpa_last_active', now.toString());
    return { userId, sessionId };
}

// 1. กรณีพิมพ์เอง -> ส่ง Trigger = null (ให้ AI ตอบ)
function handleInputSubmit() {
    const text = elements.userInput.value.trim();
    if (!text) return;
    sendMessage(text, text, null); 
}

// 2. กรณีคลิกปุ่ม FAQ หน้าแรก -> ส่ง Trigger = 'faq' (ให้ DB ตอบ)
function sendSuggestion(text) {
    // ส่ง text เดียวกันทั้ง display และ input
    // บังคับ Trigger เป็น 'faq' เพื่อให้ n8n รู้ว่าต้อง query DB
    sendMessage(text, text, 'faq');
}
window.sendSuggestion = sendSuggestion;

// 3. รีเซ็ตแชท (แจ้ง Server จบ + ล้างหน้าจอ + ลบ Session ID)
async function resetChat() {
    if (!confirm("ต้องการล้างประวัติการสนทนา?")) return;
    
    // ดึง ID เก่ามาก่อน เพื่อส่งไปบอกลา n8n
    const { userId, sessionId } = getChatMetadata();

    // ส่ง Trigger "end_chat" ไปบอก n8n
    try {
        fetch(CONFIG.WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                [CONFIG.CHAT_INPUT_KEY]: 'จบการสนทนา',
                [CONFIG.TRIGGER_KEY]: 'end_chat',
                userId: userId,
                sessionId: sessionId
            })
        });
    } catch (e) { console.error("แจ้งจบการสนทนาไม่สำเร็จ", e); }

    // ล้างหน้าจอ
    elements.chatContainer.innerHTML = `
        <div class="chat-bubble bot-bubble">
            สวัสดีครับ มีเรื่องสงสัยเกี่ยวกับ RPA หรือการเบิกจ่าย สอบถามผมได้เลยครับ 👇
        </div>
    `;
    
    // ลบเฉพาะ Session ID (เพื่อให้ getChatMetadata ครั้งหน้าไปบวกเลขสร้างใหม่)
    // *สำคัญ* ห้ามลบ rpa_session_count นะครับ ไม่งั้นมันจะเริ่ม s1 ใหม่
    localStorage.removeItem('rpa_session_id'); 
    
    // คืนค่าปุ่ม FAQ กลับมา
    renderDefaultButtons();
}

// 4. ฟังก์ชันหลักส่งข้อความ
async function sendMessage(displayMessage, inputMessage, triggerCode) {
    // ซ่อนปุ่ม Quick Reply เก่าทันที
    elements.quickReplies.classList.add('hidden'); 

    if (displayMessage) {
        addMessage(displayMessage, 'user');
    }
    elements.userInput.value = '';
    
    const loadingId = addLoading();
    const { userId, sessionId } = getChatMetadata();

    try {
        const payload = {
            [CONFIG.CHAT_INPUT_KEY]: inputMessage,
            [CONFIG.TRIGGER_KEY]: triggerCode,
            userId: userId,
            sessionId: sessionId
        };

        const response = await fetch(CONFIG.WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        removeLoading(loadingId);
        
        // เตรียมข้อมูล Response
        let rawText = data[CONFIG.RESPONSE_KEY] || data.output || data.text || '';
        let options = [];

        if (typeof data === 'object') {
            if (data.options && Array.isArray(data.options)) options = data.options;
            if (typeof rawText === 'object') rawText = rawText.output || rawText.text || JSON.stringify(rawText);
        }
        
        // รองรับ JSON String ที่อาจหลุดมา
        if (typeof rawText === 'string' && rawText.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(rawText);
                rawText = parsed.output || parsed.text || rawText;
                if (parsed.options) options = parsed.options;
            } catch (e) {}
        }

        let finalMessage = '';
        if (typeof rawText === 'string') {
             finalMessage = rawText.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\n/g, '<br>');
        } else {
             finalMessage = JSON.stringify(rawText);
        }

        addMessage(finalMessage, 'bot');

        // ถ้ามี Options ใหม่ส่งมา ให้โชว์ปุ่ม
        if (options.length > 0) {
            renderQuickReplies(options);
        } 

    } catch (error) {
        console.error(error);
        removeLoading(loadingId);
        addMessage("⚠️ เกิดข้อผิดพลาด กรุณาลองใหม่", 'bot');
    }
}

// ฟังก์ชันสร้างปุ่มตัวเลือก (Follow-up)
function renderQuickReplies(options) {
    const container = elements.quickReplies;
    container.innerHTML = ''; 
    container.classList.remove('hidden');

    options.forEach((opt, index) => {
        const btn = document.createElement('button');
        btn.className = 'chip-btn chip-anim';
        btn.innerHTML = opt.label; 
        btn.style.animationDelay = `${index * 0.05}s`;

        btn.onclick = () => {
            // กรณีเป็นปุ่มตัวเลือกจาก AI -> ส่ง Trigger = null (เพื่อให้ AI ตอบ)
            // เราไม่ใช้ sendSuggestion() เพราะนั่นมันบังคับเป็น 'faq'
            const textToSend = opt.value || opt.label;
            sendMessage(textToSend, textToSend, null); 
        };
        container.appendChild(btn);
    });
    // เลื่อนจอลง
    setTimeout(scrollToBottom, 100);
}

// ฟังก์ชันคืนค่าปุ่ม FAQ เริ่มต้น (สำหรับตอน Reset)
function renderDefaultButtons() {
    const container = elements.quickReplies;
    // ใส่ปุ่มให้ตรงกับใน HTML ของคุณ
    container.innerHTML = `
        <button onclick="sendSuggestion('ผมเบิกเงินไม่ได้')" class="chip-btn">
            <i class="fa-solid fa-money-bill-wave mr-1"></i> ผมเบิกเงินไม่ได้
        </button>
        <button onclick="sendSuggestion('สามารถดูประวัติการเบิกได้จากไหน')" class="chip-btn">
            <i class="fa-solid fa-receipt mr-1"></i> ดูประวัติการเบิก
        </button>
        <button onclick="sendSuggestion('สวัสดีครับ คุณสามารถทำอะไรได้บ้าง')" class="chip-btn">
            <i class="fa-solid fa-robot mr-1"></i> สวัสดีครับ คุณสามารถทำอะไรได้บ้าง
        </button>
    `;
    container.classList.remove('hidden');
    setTimeout(scrollToBottom, 100);
}

function addMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `chat-bubble ${sender === 'user' ? 'user-bubble' : 'bot-bubble'}`;
    div.innerHTML = text; 
    elements.chatContainer.appendChild(div);
    scrollToBottom();
}

function addLoading() {
    const id = 'loading-' + Date.now();
    const div = document.createElement('div');
    div.id = id;
    div.className = 'chat-bubble bot-bubble loading-dots';
    div.innerHTML = '<span></span><span></span><span></span>';
    elements.chatContainer.appendChild(div);
    scrollToBottom();
    return id;
}

function removeLoading(id) {
    const element = document.getElementById(id);
    if (element) element.remove();
}

function scrollToBottom() {
    elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}