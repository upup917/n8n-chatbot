// --- CONFIGURATION ---
const CONFIG = {
    // ⚠️ อย่าลืมเปลี่ยนเป็น Production URL เมื่อใช้งานจริง
    //    WEBHOOK_URL: 'https://jon-shaft-success-housing.trycloudflare.com/webhook/21c6544a-7af4-4b9b-ab08-6ab41456a75d', 
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
    welcomeScreen: document.getElementById('welcome-screen'),
    userInput: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    endChatBtn: document.getElementById('end-chat-btn'),
    quickReplies: document.getElementById('quick-replies')
};

// --- STATE ---
let isChatStarted = false;

// --- EVENT LISTENERS ---
elements.userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleInputSubmit();
});
elements.sendBtn.addEventListener('click', handleInputSubmit);
elements.endChatBtn.addEventListener('click', endChat);

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

// 1. กรณีพิมพ์เอง (ไม่มี Trigger)
function handleInputSubmit() {
    const text = elements.userInput.value.trim();
    if (!text) return;
    sendMessage(text, text, null); 
}

// 2. กรณีคลิกปุ่ม (มี Trigger)
function sendSuggestion(displayText, triggerCode) {
    sendMessage(displayText, displayText, triggerCode);
}
window.sendSuggestion = sendSuggestion;

// 3. จบการสนทนา
async function endChat() {
    if (!confirm("ต้องการจบการสนทนาใช่หรือไม่?")) return;
    
    const { userId, sessionId } = getChatMetadata();

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
    } catch (e) { console.error(e); }

    localStorage.removeItem('rpa_session_id');
    resetUI();
}

function resetUI() {
    elements.chatContainer.innerHTML = '';
    elements.userInput.value = '';
    elements.chatWrapper.classList.remove('flex');
    elements.chatWrapper.classList.add('hidden');
    elements.welcomeScreen.style.display = 'flex';
    isChatStarted = false;
}

// 4. ฟังก์ชันส่งข้อความ
async function sendMessage(displayMessage, inputMessage, triggerCode) {
    startChatUI();

    clearQuickReplies(); // เคลียร์ปุ่มเก่าก่อนเสมอ

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
        
        // --- 1. เตรียมตัวแปร options ---
        let rawText = data[CONFIG.RESPONSE_KEY] || data.output || data.text || '';
        let options = [];

        // --- 2. เช็คจาก n8n (Logic เดิม) ---
        if (typeof data === 'object') {
            if (data.options && Array.isArray(data.options)) options = data.options;
            if (typeof rawText === 'object') rawText = rawText.output || rawText.text || JSON.stringify(rawText);
        }
        
        // --- 3. เช็คจาก JSON String (Logic เดิม) ---
        if (typeof rawText === 'string' && rawText.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(rawText);
                rawText = parsed.output || parsed.text || rawText;
                if (parsed.options) options = parsed.options;
            } catch (e) {}
        }

        // 🔥 ดักจับ p:greeting ที่หน้าบ้าน
        if (triggerCode === 'p:greeting') {
            options = [
                { label: "💸 ฉันเบิกเงินไม่ได้", value: "p:rpa" },
                { label: "📜 ดูประวัติการเบิกได้จากไหน", value: "p:workflow" }
            ];
        }

        // --- 5. จัดการข้อความและแสดงผล ---
        let finalMessage = '';
        if (typeof rawText === 'string') {
             finalMessage = rawText.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\n/g, '<br>');
        } else {
             finalMessage = JSON.stringify(rawText);
        }

        addMessage(finalMessage, 'bot');

        // แสดงปุ่ม (ถ้ามี options)
        if (options.length > 0) {
            renderQuickReplies(options);
        } 

    } catch (error) {
        console.error(error);
        removeLoading(loadingId);
        addMessage("⚠️ Error", 'bot');
    }
}

function renderQuickReplies(options) {
    const container = elements.quickReplies;
    container.innerHTML = ''; 
    container.classList.remove('hidden');

    options.forEach((opt, index) => {
        const btn = document.createElement('button');
        btn.className = 'chip-btn chip-anim';
        btn.innerText = opt.label;
        btn.style.animationDelay = `${index * 0.05}s`;

        btn.onclick = () => {
            sendMessage(opt.label, opt.label, opt.value);
            clearQuickReplies(); 
        };
        
        container.appendChild(btn);
    });

    // ✨✨✨ ส่วนที่เพิ่ม: สั่งให้เลื่อนจอลงเมื่อมีปุ่มเด้งขึ้นมา ✨✨✨
    setTimeout(scrollToBottom, 100);
}

function clearQuickReplies() {
    elements.quickReplies.innerHTML = '';
    elements.quickReplies.classList.add('hidden');
}

function addMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `chat-bubble ${sender === 'user' ? 'user-bubble' : 'bot-bubble'}`;
    div.innerHTML = text; 
    elements.chatContainer.appendChild(div);
    scrollToBottom();
}

function startChatUI() {
    if (!isChatStarted) {
        elements.welcomeScreen.style.display = 'none';
        elements.chatWrapper.classList.remove('hidden');
        elements.chatWrapper.classList.add('flex');
        isChatStarted = true;
    }
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