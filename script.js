const CONFIG = {
    WEBHOOK_URL: 'http://localhost:5678/webhook-test/21c6544a-7af4-4b9b-ab08-6ab41456a75d',
    CHAT_INPUT_KEY: 'chatInput',
    TRIGGER_KEY: 'trigger',
    RESPONSE_KEY: 'output',
    SESSION_TIMEOUT_MS: 15 * 60 * 1000 
};

// --- DOM ELEMENTS ---
// ลบ welcomeScreen ออกจาก list เพราะไม่มีใน HTML แล้ว
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
elements.endChatBtn.addEventListener('click', resetChat); // เปลี่ยนปุ่มจบเป็นปุ่มรีเซ็ต

// --- FUNCTIONS ---

function getChatMetadata() {
    let userId = localStorage.getItem('rpa_user_id');
    if (!userId) {
        userId = crypto.randomUUID();
        localStorage.setItem('rpa_user_id', userId);
    }
    let sessionId = localStorage.getItem('rpa_session_id');
    const lastActive = parseInt(localStorage.getItem('rpa_last_active') || '0');
    const now = Date.now();
    if (!sessionId || (now - lastActive > CONFIG.SESSION_TIMEOUT_MS)) {
        sessionId = crypto.randomUUID();
        localStorage.setItem('rpa_session_id', sessionId);
        console.log("New Session Generated");
    }
    localStorage.setItem('rpa_last_active', now.toString());
    return { userId, sessionId };
}

// 1. พิมพ์เอง -> Trigger = null
function handleInputSubmit() {
    const text = elements.userInput.value.trim();
    if (!text) return;
    sendMessage(text, text, null); 
}

// 2. กดปุ่ม -> Trigger = 'faq' (ตามที่คุณขอ)
function sendSuggestion(text) {
    // ส่ง text เดียวกันทั้ง display และ input
    // บังคับ Trigger เป็น 'faq' เพื่อให้ n8n รู้ว่าต้อง query DB
    sendMessage(text, text, 'faq');
}
window.sendSuggestion = sendSuggestion;

// 3. รีเซ็ตแชท (ล้างหน้าจอ)
// 3. รีเซ็ตแชท (แจ้ง Server จบ + ล้างหน้าจอ + สร้าง Session ใหม่)
async function resetChat() {
    if (!confirm("ต้องการล้างประวัติการสนทนา?")) return;
    
    // ดึง ID เก่ามาก่อน เพื่อส่งไปบอกลา n8n
    const { userId, sessionId } = getChatMetadata();

    // 1. ส่ง Trigger "end_chat" ไปบอก n8n (Fire & Forget ไม่ต้องรอผลก็ได้)
    try {
        fetch(CONFIG.WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                [CONFIG.CHAT_INPUT_KEY]: 'จบการสนทนา', // ส่งข้อความให้เห็นใน Log
                [CONFIG.TRIGGER_KEY]: 'end_chat',      // Trigger สั่งงาน
                userId: userId,
                sessionId: sessionId
            })
        });
    } catch (e) { console.error("แจ้งจบการสนทนาไม่สำเร็จ", e); }

    // 2. ล้างข้อมูลฝั่งหน้าเว็บ
    elements.chatContainer.innerHTML = `
        <div class="chat-bubble bot-bubble">
            สวัสดีครับ มีเรื่องสงสัยเกี่ยวกับ RPA หรือการเบิกจ่าย สอบถามผมได้เลยครับ 👇
        </div>
    `;
    
    // 3. ลบ Session เก่าทิ้ง (ครั้งหน้าจะเจนใหม่)
    localStorage.removeItem('rpa_session_id'); 
    
    // 4. คืนค่าปุ่ม FAQ กลับมา
    renderDefaultButtons();
}
// 4. ส่งข้อความ
async function sendMessage(displayMessage, inputMessage, triggerCode) {
    // ซ่อนปุ่ม Quick Reply เก่า (ถ้ามี)
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
        
        // Prepare Response
        let rawText = data[CONFIG.RESPONSE_KEY] || data.output || data.text || '';
        let options = [];

        if (typeof data === 'object') {
            if (data.options && Array.isArray(data.options)) options = data.options;
            if (typeof rawText === 'object') rawText = rawText.output || rawText.text || JSON.stringify(rawText);
        }
        
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

        // ถ้ามี Options ใหม่จาก n8n ให้โชว์
        if (options.length > 0) {
            renderQuickReplies(options);
        } 

    } catch (error) {
        console.error(error);
        removeLoading(loadingId);
        addMessage("⚠️ เกิดข้อผิดพลาด กรุณาลองใหม่", 'bot');
    }
}

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
            // ⚠️ แก้ไขตรงนี้: ไม่ใช้ sendSuggestion แล้ว เพราะไม่อยากได้ trigger 'faq'
            // แต่ใช้ sendMessage และส่ง trigger เป็น null แทน (ให้ AI ตอบ)
            const textToSend = opt.value || opt.label;
            sendMessage(textToSend, textToSend, null); 
            
            // (ถ้าอยากให้เคลียร์ปุ่มทิ้งหลังกดด้วย ก็เปิดบรรทัดนี้ได้ครับ)
            // clearQuickReplies();
        };
        container.appendChild(btn);
    });
    setTimeout(scrollToBottom, 100);
}

// ฟังก์ชันคืนค่าปุ่มเริ่มต้น (กรณี Reset Chat)
function renderDefaultButtons() {
    const container = elements.quickReplies;
    container.innerHTML = `
        <button onclick="sendSuggestion('ผมเบิกเงินไม่ได้')" class="chip-btn">
            <i class="fa-solid fa-money-bill-wave mr-1"></i> ผมเบิกเงินไม่ได้
        </button>
        <button onclick="sendSuggestion('สามารถดูประวัติการเบิกได้จากไหน')" class="chip-btn">
            <i class="fa-solid fa-receipt mr-1"></i> ดูประวัติการเบิก
        </button>
        <button onclick="sendSuggestion('สวัสดีครับ คุณสามารถทำอะไรได้บ้าง')" class="chip-btn">
            <i class="fa-solid fa-robot mr-1"></i> นายทำอะไรได้บ้าง
        </button>
    `;
    container.classList.remove('hidden');
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