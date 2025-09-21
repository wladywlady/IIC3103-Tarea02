document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const loginView = document.getElementById('login-view');
    const mainView = document.getElementById('main-view');
    const chatContainer = document.getElementById('chat-container');
    const toggleChatViewBtn = document.createElement('button');
    toggleChatViewBtn.id = 'toggle-chat-view-btn';
    toggleChatViewBtn.classList.add('mode-btn');
    chatContainer.parentNode.insertBefore(toggleChatViewBtn, chatContainer);

    const modal = document.getElementById('decrypt-modal');
    const modalTitle = document.getElementById('modal-title');
    const statusDiv = document.getElementById('decrypt-status');
    const closeBtn = document.querySelector('.close-btn');

    let socket;
    let map;
    let decryptionInterval;
    let wsToken;
    let reconnectTimeout;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const connectionStatusDiv = document.getElementById('connection-status');

    const submarines = new Map();
    const markers = new Map();

    const MORSE_CODE_DICT = {
        '.- ': 'A', '-... ': 'B', '-.-. ': 'C', '-.. ': 'D', '. ': 'E', '..-. ': 'F', '--. ': 'G', '.... ': 'H', '.. ': 'I', '.--- ': 'J', '-.- ': 'K', '.-.. ': 'L', '-- ': 'M', '-. ': 'N', '--- ': 'O', '.--. ': 'P', '--.- ': 'Q', '.-. ': 'R', '... ': 'S', '- ': 'T', '..- ': 'U', '...- ': 'V', '.-- ': 'W', '-..- ': 'X', '-.-- ': 'Y', '--.. ': 'Z',
        '.---- ': '1', '..--- ': '2', '...-- ': '3', '....- ': '4', '..... ': '5', '-.... ': '6', '--... ': '7', '---.. ': '8', '----. ': '9', '-----': '0',
        '.-.-.-': '.', '--..-.': ',', '..--..': '?', '-.-.--': '!', '-....-': '-', '-..-.': '/', '.--.-': '@', '-.--.': '(', '-.--.-': ')', ' ': ' '
    };

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = document.getElementById('email').value;
        const studentNumber = document.getElementById('student-number').value;
        const API_URL = 'https://submarine-monitoring-902587603657.us-central1.run.app';
        try {
            const response = await fetch(`${API_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, student_number: studentNumber }) });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Error en el login');
            }
            const data = await response.json();
            loginView.style.display = 'none';
            mainView.style.display = 'block';
            wsToken = data.access_token;
            connectWebSocket(wsToken);
        } catch (error) {
            alert(`Error: ${error.message}`);
            console.error('Fallo el login:', error);
        }
    });

    document.getElementById('submarines-table-body').addEventListener('click', (event) => {
        const target = event.target.closest('.decrypt-btn');
        if (target) {
            startDecryption(target.getAttribute('data-id'));
        }
    });

    closeBtn.onclick = () => {
        modal.style.display = "none";
        clearInterval(decryptionInterval);
    };
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = "none";
            clearInterval(decryptionInterval);
        }
    };

    function connectWebSocket(token) {
        if (!token) return;

        const WSS_URL = `wss://submarine-monitoring-902587603657.us-central1.run.app/ws?token=${token}`;
        socket = new WebSocket(WSS_URL);

        connectionStatusDiv.textContent = 'Conectando al servidor...';
        connectionStatusDiv.className = 'status-connecting';

        socket.onopen = () => {
            console.log('Conectado al servidor WebSocket.');
            connectionStatusDiv.textContent = 'Conectado';
            connectionStatusDiv.className = 'status-connected';
            if (!map) {
                initializeMap();
            }
            reconnectAttempts = 0;
            clearTimeout(reconnectTimeout);
        };
        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            switch (message.type) {
                case 'PING_RESPONSE':
                    handlePingResponse(message.payload.detected_submarines);
                    break;
                case 'SUBMARINE_UPDATE':
                    handleSubmarineUpdate(message.payload);
                    break;
                case 'COMMUNICATION_INTERCEPTED':
                    handleCommunication(message.payload);
                    break;
            }
        };
        socket.onclose = (event) => {
            console.log('Desconectado del servidor WebSocket.', event);
            connectionStatusDiv.textContent = 'Desconectado. Intentando reconectar...';
            connectionStatusDiv.className = 'status-disconnected';

            if (event.code === 1000 || !wsToken) {
                return;
            }

            reconnectAttempts++;
            if (reconnectAttempts > maxReconnectAttempts) {
                console.error('Se alcanzó el máximo de intentos de reconexión.');
                connectionStatusDiv.textContent = 'Fallo la reconexión. Por favor, recargue la página.';
                connectionStatusDiv.className = 'status-failed';
                return;
            }

            const timeout = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
            connectionStatusDiv.textContent = `Desconectado. Reintentando en ${Math.round(timeout/1000)}s...`;
            reconnectTimeout = setTimeout(() => connectWebSocket(wsToken), timeout);
        };
        socket.onerror = (error) => {
            console.error('Error de WebSocket:', error);
            connectionStatusDiv.textContent = 'Error de conexión.';
            connectionStatusDiv.className = 'status-failed';
        };
    }

    // Procesa la respuesta del ping, añadiendo nuevos submarinos detectados.
    function handlePingResponse(detectedSubmarines) {
        if (!detectedSubmarines || detectedSubmarines.length === 0) return;
        detectedSubmarines.forEach(sub => {
            if (!submarines.has(sub.submarine_id)) {
                addNewSubmarine(sub);
            }
        });
        renderTable();
    }

    function addNewSubmarine(sub) {
        const subData = {
            id: sub.submarine_id,
            name: 'Desconocido',
            state: 'Encriptado',
            position: sub.position,
            encryptedPayload: sub.encrypted_payload,
            difficulty: sub.encryption_difficulty,
            history: [sub.position],
            polyline: null,
            messageFragments: {},
            messagesReceived: 0,
            packetsReceived: 0,
            lastMessage: 'N/A',
            decryptedInfo: null
        };
        submarines.set(sub.submarine_id, subData);
        const marker = L.circleMarker([sub.position.lat, sub.position.long], { radius: 8, fillColor: "white", color: "black", weight: 1, opacity: 1, fillOpacity: 0.9 }).addTo(map);
        markers.set(sub.submarine_id, marker);
        updatePopupContent(sub.submarine_id);
    }

     // Actualiza la posición del submarino y dibuja su trayectoria si está desencriptado.
    function handleSubmarineUpdate(payload) {
        const sub = submarines.get(payload.submarine_id);
        if (sub && sub.key) {
            const decrypted = xorDecrypt(payload.encrypted_payload, sub.key);
            try {
                const info = JSON.parse(decrypted);
                const newPosition = [info.position.latitude, info.position.longitude];
                sub.position = { lat: newPosition[0], long: newPosition[1] };
                sub.history.push(sub.position);
                const marker = markers.get(sub.id);
                if (marker) {
                    marker.setLatLng(newPosition);
                }
                const polylineColor = sub.color || 'orange';
                if (sub.polyline) {
                    sub.polyline.addLatLng(newPosition);
                } else {
                    sub.polyline = L.polyline(sub.history.map(p => [p.lat, p.long]), { color: polylineColor }).addTo(map);
                }
            } catch (e) {}
        }
    }

    const chatViews = ['Texto Plano', 'Morse', 'Encriptado'];
    let currentChatView = chatViews[0];
    toggleChatViewBtn.textContent = `Visualización de contenido: ${currentChatView}`;

    toggleChatViewBtn.addEventListener('click', () => {
        const currentIndex = chatViews.indexOf(currentChatView);
        currentChatView = chatViews[(currentIndex + 1) % chatViews.length];
        toggleChatViewBtn.textContent = `Visualización de contenido: ${currentChatView}`;
        const messages = chatContainer.querySelectorAll('p');
        messages.forEach(msg => {
            const sub = submarines.get(msg.dataset.submarineId);
            renderChatMessage(msg, sub, msg.dataset.timestamp);
        });
    });

     // Gestiona los mensajes interceptados, ensambla los paquetes y los prepara para visualización.
    function handleCommunication(payload) {
        const { submarine_id, timestamp, package_number, total_packages, encrypted_payload } = payload;
        const sub = submarines.get(submarine_id);
        if (!sub) return;

        sub.packetsReceived++;

        if (!sub.messageFragments[timestamp]) {
            sub.messageFragments[timestamp] = {
                fragments: new Array(total_packages),
                receivedCount: 0
            };
        }

        const messageAssembly = sub.messageFragments[timestamp];
        if (messageAssembly.fragments[package_number - 1] === undefined) {
            messageAssembly.fragments[package_number - 1] = encrypted_payload;
            messageAssembly.receivedCount++;
        }

        if (messageAssembly.receivedCount === total_packages) {
            const fullEncryptedMessage = messageAssembly.fragments.join('');
            delete sub.messageFragments[timestamp];
            sub.messagesReceived++;

            let messageData;
            if (sub.key) {
                const morseMessage = xorDecrypt(fullEncryptedMessage, sub.key);
                const plainTextMessage = morseToText(morseMessage);
                sub.lastMessage = plainTextMessage;
                messageData = { 'Texto Plano': plainTextMessage, 'Morse': morseMessage, 'Encriptado': fullEncryptedMessage };
            } else {
                sub.lastMessage = '[Mensaje Encriptado]';
                messageData = { 'Texto Plano': sub.lastMessage, 'Morse': sub.lastMessage, 'Encriptado': fullEncryptedMessage };
            }
            addMessageToChat(sub, messageData, timestamp);
            updatePopupContent(submarine_id);
        }
    }

   // Traduce una cadena de código Morse a texto legible.
    function morseToText(morseString) {
        if (!morseString || typeof morseString !== 'string') return '';
        return morseString.trim().split('   ').map(word =>
            word.split(' ').map(code => MORSE_CODE_DICT[code + ' '] || '').join('')
        ).join(' ');
    }

    function addMessageToChat(sub, messageData, timestamp) {
        const messageElement = document.createElement('p');
        messageElement.dataset.timestamp = timestamp;
        messageElement.dataset.submarineId = sub ? sub.id : 'unknown';
        messageElement.messageData = messageData;
        renderChatMessage(messageElement, sub, timestamp);
        chatContainer.appendChild(messageElement);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function renderChatMessage(messageElement, sub, timestamp) {
        const messageData = messageElement.messageData;
        const formattedTimestamp = new Date(timestamp).toLocaleTimeString();
        const color = sub && sub.color ? sub.color : '#000000';
        const name = sub && sub.name ? sub.name : 'Desconocido';
        const subId = sub ? sub.id : messageElement.dataset.submarineId;
        const subNamePart = `<strong style="color: ${color};">[${formattedTimestamp}] ${name} (${subId}):</strong>`;
        let content = messageData[currentChatView] || '';
        messageElement.innerHTML = `${subNamePart} ${content}`;
    }

    function xorDecrypt(encryptedBase64, key) {
        try {
            const encryptedText = atob(encryptedBase64);
            let result = '';
            for (let i = 0; i < encryptedText.length; i++) {
                result += String.fromCharCode(encryptedText.charCodeAt(i) ^ key);
            }
            return result;
        } catch (e) {
            return 'Error al decodificar Base64';
        }
    }

    // Inicia la simulación de desencriptación en un modal, mostrando el proceso y actualizando el estado.
    function startDecryption(submarineId) {
        const sub = submarines.get(submarineId);
        if (!sub || sub.state !== 'Encriptado') return;

        modalTitle.textContent = `Desencriptando ${submarineId}`;
        statusDiv.innerHTML = '';
        modal.style.display = 'block';
        sub.state = 'Descifrando...';
        renderTable();

        let key = 0;
        decryptionInterval = setInterval(() => {
            if (key > sub.difficulty) {
                clearInterval(decryptionInterval);
                statusDiv.innerHTML += `<p style="color: var(--error-color);"><strong>Fallo la desencriptación.</strong></p>`;
                sub.state = 'Fallido';
                renderTable();
                return;
            }

            const decrypted = xorDecrypt(sub.encryptedPayload, key);
            const statusLine = document.createElement('p');
            statusLine.innerHTML = `<b>Clave probada:</b> ${key}<br><b>Resultado:</b> ${escapeHtml(decrypted)}`;
            statusDiv.appendChild(statusLine);
            statusDiv.scrollTop = statusDiv.scrollHeight;

            if (decrypted.startsWith('{')) {
                try {
                    const info = JSON.parse(decrypted);
                    clearInterval(decryptionInterval);
                    statusDiv.innerHTML += `<p style="color: var(--success-color);"><strong>¡Éxito! Clave encontrada: ${key}</strong></p>`;
                    modalTitle.textContent = '¡Desencriptado con Éxito!';
                    sub.name = info.name;
                    sub.state = 'Desencriptado';
                    sub.key = key;
                    sub.decryptedInfo = info;
                    sub.color = info.color;
                    markers.get(submarineId).setStyle({ fillColor: info.color || 'white' });
                    updatePopupContent(submarineId);
                    renderTable();
                    return;
                } catch (e) {}
            }
            key++;
        }, 50);
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

     // Actualiza el contenido del tooltip del marcador de un submarino con su información detallada.
    function updatePopupContent(submarineId) {
        const sub = submarines.get(submarineId);
        const marker = markers.get(submarineId);
        if (!sub || !marker) return;

        let content = `<b>ID:</b> ${sub.id}<br>`;
        if (sub.state === 'Desencriptado' && sub.decryptedInfo) {
            content += `
                <b>Nombre:</b> ${sub.decryptedInfo.name}<br>
                <b>País:</b> ${sub.decryptedInfo.country}<br>
                <b>Capitán:</b> ${sub.decryptedInfo.captain}<br>
                <b>Tipo:</b> ${sub.decryptedInfo.type}<br>
                <b>Mensajes:</b> ${sub.messagesReceived}<br>
                <b>Paquetes:</b> ${sub.packetsReceived}<br>
                <b>Último mensaje:</b> ${sub.lastMessage}
            `;
        } else {
            content += `Estado: Encriptado.`;
        }
        marker.bindPopup(content);
    }

     // Renderiza la tabla de submarinos, mostrando su estado actual.
    function renderTable() {
        const tableBody = document.getElementById('submarines-table-body');
        tableBody.innerHTML = '';
        submarines.forEach(sub => {
            const row = document.createElement('tr');
            let buttonHtml = `<button data-id="${sub.id}" class="decrypt-btn">Desencriptar</button>`;
            if (sub.state === 'Desencriptado') {
                buttonHtml = '✅';
            } else if (sub.state === 'Descifrando...') {
                buttonHtml = '<span class="loader-small"></span>';
            } else if (sub.state === 'Fallido') {
                buttonHtml = '❌';
            }
            row.innerHTML = `<td>${sub.id}</td><td>${sub.name}</td><td>${sub.state}</td><td class="action-cell">${buttonHtml}</td>`;
            tableBody.appendChild(row);
        });
    }

    function initializeMap() {
        map = L.map('map').setView([-33.456, -70.648], 4);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
        setTimeout(() => map.invalidateSize(), 100);
        map.on('click', (e) => {
            sendPing(e.latlng.lat, e.latlng.lng);
        });
    }

    // Envía una solicitud de ping al servidor con las coordenadas del click.
    function sendPing(lat, lng) {
        const pingRequest = { type: "PING_REQUEST", payload: { coordinates: { latitude: lat, longitude: lng } } };
        socket.send(JSON.stringify(pingRequest));
        const pingCircle = L.circle([lat, lng], { radius: 150000, color: 'blue', fillColor: 'blue', fillOpacity: 0.1 });
        pingCircle.addTo(map);
        setTimeout(() => { if (map.hasLayer(pingCircle)) map.removeLayer(pingCircle); }, 1500);
    }
});
