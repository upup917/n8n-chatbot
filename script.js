// --- CONFIGURATION ---
const CONFIG = {
    // ⚠️ ตรวจสอบ URL นี้ให้ตรงกับ n8n Tunnel ของคุณ
    WEBHOOK_URL: 'http://localhost:5678/webhook-test/21c6544a-7af4-4b9b-ab08-6ab41456a75d',
    CHAT_INPUT_KEY: 'chatInput',
    TRIGGER_KEY: 'trigger',
    RESPONSE_KEY: 'output', // Key หลักที่ n8n ส่งกลับมา
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

// ฟังก์ชันจัดการ Session ID
// ฟังก์ชันจัดการ Session ID
function getChatMetadata() {
    let userId = localStorage.getItem('rpa_user_id');
    if (!userId) {
        // userId แบบสั้น (u + สุ่ม 5 หลัก)
        userId = 'u' + Math.random().toString(36).substring(2, 7);
        localStorage.setItem('rpa_user_id', userId);
    }

    let sessionId = localStorage.getItem('rpa_session_id');
    const lastActive = parseInt(localStorage.getItem('rpa_last_active') || '0');
    const now = Date.now();

    // ถ้าหมดเวลา หรือยังไม่มี Session -> สร้างใหม่
    if (!sessionId || (now - lastActive > CONFIG.SESSION_TIMEOUT_MS)) {
        
        // 🔥 สูตรใหม่: s + สุ่ม 5 ตัวอักษร (เช่น sk8x9z)
        // substring(2, 7) คือตัดเอาเลข 0. ข้างหน้าออก แล้วหยิบมา 5 ตัว
        sessionId = 's' + Math.random().toString(36).substring(2, 7);

        localStorage.setItem('rpa_session_id', sessionId);
        console.log("New Session Generated:", sessionId);
    }

    localStorage.setItem('rpa_last_active', now.toString());
    return { userId, sessionId };
}

function handleInputSubmit() {
    const text = elements.userInput.value.trim();
    if (!text) return;
    sendMessage(text, text, null); 
}

function sendSuggestion(text) {
    sendMessage(text, text, 'faq');
}
window.sendSuggestion = sendSuggestion;

async function resetChat() {
    // ⚠️ ลบบรรทัด confirm เดิมออกไปแล้ว
    
    // ดึง ID เก่ามาก่อน เพื่อส่งไปบอกลา n8n
    const { userId, sessionId } = getChatMetadata();

    // 1. ส่ง Trigger "end_chat" ไปบอก n8n
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

    // 2. ล้างข้อมูลฝั่งหน้าเว็บ
    elements.chatContainer.innerHTML = `
        <div class="chat-bubble bot-bubble">
            สวัสดีครับ มีเรื่องสงสัยเกี่ยวกับ RPA หรือการเบิกจ่าย สอบถามผมได้เลยครับ 👇
        </div>
    `;
    
    // 3. ลบ Session เก่าทิ้ง
    localStorage.removeItem('rpa_session_id'); 
    
    // 4. คืนค่าปุ่ม FAQ กลับมา
    renderDefaultButtons();
}

// --- CORE FUNCTION: ส่งและรับข้อความ ---
async function sendMessage(displayMessage, inputMessage, triggerCode) {
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
        
        // 🔥 เรียกใช้ Smart Parser เพื่อแกะข้อมูล (แก้ปัญหา Options ไม่ขึ้น)
        const { finalMessage, finalOptions } = parseResponseData(data);

        addMessage(finalMessage, 'bot');

        // ถ้ามี Options ให้แสดงปุ่ม
        if (finalOptions.length > 0) {
            renderQuickReplies(finalOptions);
        } 

    } catch (error) {
        console.error("Error:", error);
        removeLoading(loadingId);
        addMessage("⚠️ เกิดข้อผิดพลาด กรุณาลองใหม่", 'bot');
    }
}

// 🔥 ฟังก์ชันอัจฉริยะสำหรับแกะ Response (แก้ Bug ตรงนี้)
function parseResponseData(data) {
    let text = '';
    let options = [];

    // Helper: พยายามดึง text และ options จาก object ใดๆ
    const extract = (obj) => {
        return {
            t: obj[CONFIG.RESPONSE_KEY] || obj.output || obj.text || obj.response || '',
            o: obj.options || obj.suggestions || []
        };
    };

    // 1. ดึงจาก Data ชั้นแรกสุด
    let extracted = extract(data);
    text = extracted.t;
    options = extracted.o;

    // 2. ถ้า text ที่ได้มา ดันเป็น Object (Nested JSON) ให้มุดเข้าไปดึงอีกรอบ
    if (typeof text === 'object' && text !== null) {
        const nested = extract(text);
        // ถ้าข้างในมี text ให้เอามาใช้
        if (nested.t) text = nested.t;
        // ถ้าข้างในมี options ให้เอามาทับของเดิม (เพราะแม่นยำกว่า)
        if (nested.o && Array.isArray(nested.o) && nested.o.length > 0) {
            options = nested.o;
        }
        
        // ถ้ายังเป็น Object อยู่ ให้ลองแปลงเป็น String เพื่อเตรียม Parse ต่อ
        if (typeof text === 'object') text = JSON.stringify(text);
    }

    // 3. ถ้า text เป็น String และหน้าตาเหมือน JSON (เช่น AI ตอบมาเป็น JSON String)
    if (typeof text === 'string') {
        // ล้าง Markdown Code Block ออกก่อน (```json ... ```)
        const cleanJson = text.trim()
            .replace(/^```json/i, '')
            .replace(/^```/i, '')
            .replace(/```$/i, '')
            .trim();

        if (cleanJson.startsWith('{') || cleanJson.startsWith('[')) {
            try {
                const parsed = JSON.parse(cleanJson);
                const parsedData = extract(parsed);
                
                // อัปเดต text และ options จาก JSON ที่แกะได้
                if (parsedData.t) text = parsedData.t;
                if (parsedData.o && Array.isArray(parsedData.o) && parsedData.o.length > 0) {
                    options = parsedData.o;
                }
            } catch (e) {
                // ถ้า Parse ไม่ผ่าน ก็ใช้ text เดิมไป
                console.log("Not a valid JSON string, using raw text.");
            }
        }
    }

    // 4. จัดรูปแบบข้อความสุดท้าย (ลบ Quote, เปลี่ยน \n เป็น <br>)
    let formattedText = '';
    if (typeof text === 'string') {
        formattedText = text.replace(/^"|"$/g, '').replace(/\\n/g, '\n').replace(/\n/g, '<br>');
    } else {
        formattedText = JSON.stringify(text); // กันเหนียว
    }

    return { finalMessage: formattedText, finalOptions: options };
}

// ฟังก์ชันสร้างปุ่มตัวเลือก
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
            const textToSend = opt.value || opt.label;
            sendMessage(textToSend, textToSend, null); 
        };
        container.appendChild(btn);
    });
    setTimeout(scrollToBottom, 100);
}

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
            <i class="fa-solid fa-robot mr-1"></i> สวัสดีครับ คุณสามารถทำอะไรได้บ้าง
        </button>
    `;
    container.classList.remove('hidden');
    setTimeout(scrollToBottom, 100);
}

function addMessage(text, sender) {
    const div = document.createElement('div');
    div.className = `chat-bubble ${sender === 'user' ? 'user-bubble' : 'bot-bubble'}`;
    div.innerHTML = text; // ใส่ข้อความก่อน

    // 🔥 ถ้าเป็น Bot ให้เพิ่มปุ่ม Like/Dislike
    if (sender === 'bot') {
        const feedbackDiv = document.createElement('div');
        feedbackDiv.className = 'feedback-container';
        
        // ปุ่ม Like
        const likeBtn = document.createElement('button');
        likeBtn.className = 'feedback-btn';
        likeBtn.innerHTML = '<i class="fa-solid fa-thumbs-up"></i>';
        likeBtn.onclick = function() { sendFeedback(this, 'like', text); }; // ส่งข้อความ text กลับไปบันทึก

        // ปุ่ม Dislike
        const dislikeBtn = document.createElement('button');
        dislikeBtn.className = 'feedback-btn';
        dislikeBtn.innerHTML = '<i class="fa-solid fa-thumbs-down"></i>';
        dislikeBtn.onclick = function() { sendFeedback(this, 'dislike', text); };

        feedbackDiv.appendChild(likeBtn);
        feedbackDiv.appendChild(dislikeBtn);
        div.appendChild(feedbackDiv);
    }

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

// ฟังก์ชันส่ง Feedback (Like/Dislike)
async function sendFeedback(btnElement, rating, messageContent) {
    // 1. เปลี่ยนสีปุ่มให้รู้ว่ากดแล้ว
    const parent = btnElement.parentElement;
    const buttons = parent.querySelectorAll('.feedback-btn');
    buttons.forEach(b => b.classList.remove('active-like', 'active-dislike')); // ล้างค่าเก่า
    
    if (rating === 'like') btnElement.classList.add('active-like');
    else btnElement.classList.add('active-dislike');

    // 2. ส่งข้อมูลไป n8n
    const { userId, sessionId } = getChatMetadata();
    
    try {
        await fetch(CONFIG.WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                [CONFIG.CHAT_INPUT_KEY]: messageContent, // ส่งเนื้อหาข้อความบอทไปเก็บด้วย
                [CONFIG.TRIGGER_KEY]: 'feedback',       // Trigger พิเศษบอก n8n ว่านี่คือ feedback
                rating: rating,                         // 'like' หรือ 'dislike'
                userId: userId,
                sessionId: sessionId
            })
        });
        console.log(`Feedback sent: ${rating}`);
    } catch (e) {
        console.error("Failed to send feedback", e);
    }
}

// --- MANUAL TOOLTIP LOGIC ---
const manualBtn = document.getElementById('manual-btn');
const manualTooltip = document.getElementById('manual-tooltip');
const manualWrapper = document.getElementById('manual-wrapper');

if (manualBtn && manualTooltip && manualWrapper) {
    

    manualWrapper.addEventListener('mouseenter', () => {
        manualTooltip.classList.remove('hidden');
    });

    manualWrapper.addEventListener('mouseleave', () => {
        manualTooltip.classList.add('hidden');
    });

}

// --- TERMS OF USE LOGIC ---
document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById('terms-modal');
    const acceptBtn = document.getElementById('accept-terms-btn');
    const chatWrapper = document.getElementById('chat-wrapper'); // อ้างอิงกล่องแชท
    
    const hasAccepted = localStorage.getItem('rpa_terms_accepted');

    if (!hasAccepted) {
        // 1. ถ้ายังไม่ยอมรับ -> โชว์ Modal ทับทันที
        modal.classList.remove('hidden');
        
        // (เทคนิค) ซ่อนกล่องแชทไว้ข้างหลังก่อน กันเผลอเห็นแว้บๆ
        chatWrapper.classList.add('opacity-0');

        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modal.querySelector('div').classList.remove('scale-95');
            modal.querySelector('div').classList.add('scale-100');
        }, 50);

        // 2. นับถอยหลัง 3 วินาที
        let timeLeft = 3;
        const timer = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                acceptBtn.innerText = `กรุณารอสักครู่ (${timeLeft})`;
            } else {
                clearInterval(timer);
                acceptBtn.innerHTML = '<i class="fa-solid fa-check mr-2"></i> ยอมรับเงื่อนไข';
                acceptBtn.disabled = false;
                
                // เปลี่ยน Style ปุ่มเป็นสีน้ำเงินสวยๆ
                acceptBtn.className = "w-full py-3.5 rounded-xl font-semibold transition-all duration-300 bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg hover:shadow-indigo-500/30 transform hover:-translate-y-0.5 cursor-pointer text-sm";
            }
        }, 1000);

        // 3. เมื่อกดปุ่มยอมรับ
        acceptBtn.addEventListener('click', () => {
            localStorage.setItem('rpa_terms_accepted', 'true');
            
            // Effect: Modal จางหายไป
            modal.classList.add('opacity-0');
            modal.querySelector('div').classList.add('scale-110'); // ขยายออกนิดนึงตอนจบ
            
            // Effect: Chat ค่อยๆ ปรากฏขึ้นมา (Fade In)
            chatWrapper.classList.remove('opacity-0');
            chatWrapper.classList.add('transition-opacity', 'duration-700');

            setTimeout(() => {
                modal.classList.add('hidden');
            }, 500);
        });
    } else {
        // ถ้าเคยยอมรับแล้ว -> ให้แน่ใจว่าแชทโชว์ปกติ
        chatWrapper.classList.remove('opacity-0');
    }
});

// --- RESET MODAL LOGIC ---
const resetModal = document.getElementById('reset-modal');
const confirmResetBtn = document.getElementById('confirm-reset-btn');
const cancelResetBtn = document.getElementById('cancel-reset-btn');

// 1. เปลี่ยนพฤติกรรมปุ่ม "ล้างการสนทนา" เดิม -> ให้เปิด Modal แทน
if (elements.endChatBtn) {
    // ลบ Event เดิมทิ้งก่อน (ถ้ามี) หรือใช้วิธี Override
    elements.endChatBtn.replaceWith(elements.endChatBtn.cloneNode(true));
    // ดึง Element ใหม่มาผูก Event
    elements.endChatBtn = document.getElementById('end-chat-btn');
    
    elements.endChatBtn.addEventListener('click', () => {
        resetModal.classList.remove('hidden');
        // Animation Fade In
        setTimeout(() => {
            resetModal.classList.remove('opacity-0');
            resetModal.querySelector('div').classList.remove('scale-95');
            resetModal.querySelector('div').classList.add('scale-100');
        }, 10);
    });
}

// 2. ปุ่มยกเลิก (ปิด Modal)
if (cancelResetBtn) {
    cancelResetBtn.addEventListener('click', closeResetModal);
}

// 3. ปุ่มยืนยันสีแดง (เรียกฟังก์ชันล้างจริง)
if (confirmResetBtn) {
    confirmResetBtn.addEventListener('click', () => {
        closeResetModal();
        resetChat(); // 🔥 เรียกฟังก์ชัน resetChat (ที่เราจะแก้ข้างล่าง)
    });
}

function closeResetModal() {
    resetModal.classList.add('opacity-0');
    resetModal.querySelector('div').classList.remove('scale-100');
    resetModal.querySelector('div').classList.add('scale-95');
    setTimeout(() => resetModal.classList.add('hidden'), 300);
}