/**
 * USB Transport for FPVGate
 * 
 * Provides USB Serial CDC connectivity for direct, local-only communication with FPVGate.
 * Works in both browser (via Web Serial API) and Electron (via node-serialport).
 * 
 * Features:
 * - JSON command protocol over Serial CDC at 115200 baud
 * - Automatic line buffering for reliable JSON parsing
 * - Event-driven architecture matching WiFi EventSource API
 * - Bidirectional communication (send commands, receive events)
 * - Compatible with all FPVGate features: timing, LED control, configuration
 * 
 * Protocol:
 *   Commands: {"method":"POST","path":"timer/start","data":{}}
 *   Responses: {"success":true,"data":{...}}
 *   Events: EVENT:{"type":"lap","data":12345}
 * 
 * Usage:
 *   const usb = new USBTransport();
 *   await usb.connect('COM3');  // Windows
 *   await usb.connect('/dev/ttyUSB0');  // Linux  
 *   usb.on('lap', (data) => console.log('Lap:', data));
 *   const response = await usb.sendCommand('timer/start', 'POST');
 */

class USBTransport {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.connected = false;
        this.commandId = 1;
        this.responseHandlers = new Map();
        this.eventHandlers = {
            rssi: [],
            lap: [],
            raceState: [],
            slaveLap: [],
            configUpdated: [],
            disconnect: []
        };
        this.isElectron = typeof window.electronAPI !== 'undefined';
        this.electronListenersBound = false;
    }

    /**
     * Check if Web Serial API is supported
     */
    isSupported() {
        return this.isElectron || ('serial' in navigator);
    }

    /**
     * Connect to USB device
     */
    async connect(portPath = null) {
        let openedElectronPort = false;
        try {
            if (this.isElectron) {
                // Electron mode - use Node.js serialport
                if (!portPath) {
                    // Auto-detect FPVGate device
                    const ports = await window.electronAPI.listPorts();
                    const fpvgatePorts = ports.filter(p => 
                        p.manufacturer && p.manufacturer.includes('Espressif') ||
                        p.path && p.path.includes('COM') // Windows COM ports
                    );
                    
                    if (fpvgatePorts.length === 0) {
                        throw new Error('No FPVGate device found. Please plug in your device.');
                    }
                    
                    if (fpvgatePorts.length === 1) {
                        portPath = fpvgatePorts[0].path;
                    } else {
                        // Multiple devices - let user choose
                        portPath = await this.showPortSelector(fpvgatePorts);
                        if (!portPath) throw new Error('No port selected');
                    }
                }
                
                // Connect to selected port
                const result = await window.electronAPI.connectSerial(portPath);
                if (!result.success) {
                    throw new Error(result.error || 'Failed to connect');
                }
                openedElectronPort = true;

                this.bindElectronListeners();
                this.connected = true;
                this.port = portPath;
                await this.waitForDeviceReady();
                console.log('[USB] Connected to', portPath);
                return true;
                
            } else {
                // Browser mode - use Web Serial API
                this.port = await navigator.serial.requestPort();
                await this.port.open({ baudRate: 115200 });

                console.log('[USB] Connected to FPVGate');
                this.connected = true;

                // Set up reader
                const textDecoder = new TextDecoderStream();
                this.port.readable.pipeTo(textDecoder.writable);
                this.reader = textDecoder.readable.getReader();

                // Set up writer
                const textEncoder = new TextEncoderStream();
                textEncoder.readable.pipeTo(this.port.writable);
                this.writer = textEncoder.writable.getWriter();

                // Start reading
                this.readLoop();
                return true;
            }
        } catch (error) {
            console.error('[USB] Connection error:', error);
            this.connected = false;
            if (this.isElectron && openedElectronPort) {
                try {
                    await window.electronAPI.disconnectSerial();
                } catch (disconnectError) {
                    console.error('[USB] Disconnect after failed connect error:', disconnectError);
                }
            }
            throw error;
        }
    }
    
    /**
     * Show port selector dialog
     */
    async showPortSelector(ports) {
        return new Promise((resolve) => {
            const portList = ports.map((p, i) => 
                `${i + 1}. ${p.path} (${p.manufacturer || 'Unknown'})`
            ).join('\n');
            
            const selection = prompt(
                `Multiple FPVGate devices found:\n\n${portList}\n\nEnter number (1-${ports.length}):`,
                '1'
            );
            
            if (selection) {
                const index = parseInt(selection) - 1;
                if (index >= 0 && index < ports.length) {
                    resolve(ports[index].path);
                    return;
                }
            }
            resolve(null);
        });
    }

    /**
     * Disconnect from USB device
     */
    async disconnect() {
        try {
            if (this.isElectron) {
                await window.electronAPI.disconnectSerial();
            } else {
                if (this.reader) {
                    await this.reader.cancel();
                    this.reader = null;
                }
                if (this.writer) {
                    await this.writer.close();
                    this.writer = null;
                }
                if (this.port) {
                    await this.port.close();
                    this.port = null;
                }
            }
            this.connected = false;
            console.log('[USB] Disconnected');
        } catch (error) {
            console.error('[USB] Disconnect error:', error);
        }
    }

    /**
     * Read loop - processes incoming messages (Browser mode only)
     */
    async readLoop() {
        try {
            while (this.reader) {
                const { value, done } = await this.reader.read();
                if (done) break;

                // Process each line
                const lines = value.split('\n');
                for (let line of lines) {
                    line = line.trim();
                    if (!line) continue;

                    // Try to parse as JSON
                    try {
                        const data = JSON.parse(line);
                        this.handleMessage(data);
                    } catch (e) {
                        // Not JSON, probably debug output - ignore
                        console.log('[USB Debug]', line);
                    }
                }
            }
        } catch (error) {
            console.error('[USB] Read error:', error);
            this.connected = false;
        }
    }

    /**
     * Handle incoming message
     */
    handleMessage(msg) {
        // Handle events
        if (msg.event) {
            const handlers = this.eventHandlers[msg.event];
            if (handlers) {
                handlers.forEach(handler => handler(msg.data));
            }
            return;
        }

        // Handle responses
        if (msg.id !== undefined && msg.status) {
            const handler = this.responseHandlers.get(msg.id);
            if (handler) {
                handler(msg);
                this.responseHandlers.delete(msg.id);
            }
        }
    }

    /**
     * List available serial ports (Electron only)
     */
    async listPorts() {
        if (!this.isElectron) {
            throw new Error('listPorts is only available in Electron mode');
        }
        return await window.electronAPI.listPorts();
    }

    /**
     * Send command and get response
     * @param {string} cmd - Command path (e.g., 'timer/start', 'config')
     * @param {string} method - HTTP method (GET, POST) - optional, defaults to POST
     * @param {object} data - Command data - optional
     */
    normalizeCommand(cmd, method = 'POST', data = null) {
        let normalizedMethod = method;
        let normalizedData = data;

        if (normalizedMethod && typeof normalizedMethod === 'object' && normalizedData === null) {
            normalizedData = normalizedMethod;
            normalizedMethod = 'POST';
        }

        let normalizedCmd = String(cmd || '').replace(/^\//, '');
        normalizedMethod = String(normalizedMethod || 'POST').toUpperCase();

        if (normalizedCmd === 'config') {
            normalizedCmd = normalizedMethod === 'GET' ? 'config/get' : 'config/set';
        } else if (normalizedCmd === 'timer/rssiStart') {
            normalizedCmd = 'rssi/start';
        } else if (normalizedCmd === 'timer/rssiStop') {
            normalizedCmd = 'rssi/stop';
        } else if (normalizedCmd === 'api/selftest') {
            normalizedCmd = 'selftest';
        }

        return { cmd: normalizedCmd, data: normalizedData };
    }

    getCommandTimeoutMs(cmd) {
        switch (cmd) {
            case 'selftest':
                return 180000;
            case 'session/open':
            case 'config/get':
            case 'config/set':
            case 'rssi/start':
            case 'rssi/stop':
                return 15000;
            default:
                return 8000;
        }
    }

    bindElectronListeners() {
        if (!this.isElectron || this.electronListenersBound) return;

        window.electronAPI.onSerialData((data) => {
            try {
                const msg = JSON.parse(data);
                this.handleMessage(msg);
            } catch (e) {
                // Not JSON, probably boot/debug output
                console.log('[USB Debug]', data);
            }
        });

        window.electronAPI.onSerialError((error) => {
            console.error('[USB] Error:', error);
            this.connected = false;
        });

        window.electronAPI.onSerialDisconnected(() => {
            console.log('[USB] Disconnected');
            this.connected = false;
            this.eventHandlers.disconnect.forEach(handler => handler());
        });

        this.electronListenersBound = true;
    }

    async waitForDeviceReady() {
        if (!this.isElectron) return;

        const attempts = 10;
        const initialDelayMs = 1500;
        const retryDelayMs = 750;

        await new Promise((resolve) => setTimeout(resolve, initialDelayMs));

        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const session = await this.sendCommand('session/open', 'POST', {
                    client: 'electron',
                    protocol: 'usb-session-v1',
                });
                console.log('[USB] Device handshake OK', session);
                return;
            } catch (error) {
                lastError = error;
                console.warn(`[USB] Handshake attempt ${attempt}/${attempts} failed: ${error.message}`);
                if (attempt < attempts) {
                    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                }
            }
        }

        throw new Error(`Device opened on ${this.port}, but did not respond to FPVGate commands${lastError ? `: ${lastError.message}` : ''}`);
    }

    async sendCommand(cmd, method = 'POST', data = null) {
        if (!this.connected) {
            throw new Error('Not connected to USB device');
        }

        if (this.isElectron) {
            const normalizedElectron = this.normalizeCommand(cmd, method, data);
            const electronTimeoutMs = this.getCommandTimeoutMs(normalizedElectron.cmd);
            console.log('[USB] ->', JSON.stringify({
                cmd: normalizedElectron.cmd,
                data: normalizedElectron.data,
                timeoutMs: electronTimeoutMs,
            }));

            const response = await window.electronAPI.sendSerialCommand(
                normalizedElectron.cmd,
                normalizedElectron.data,
                electronTimeoutMs
            );

            if (!response || response.status !== 'OK') {
                throw new Error((response && response.message) || 'Command failed');
            }

            return response.data || {};
        }

        const normalized = this.normalizeCommand(cmd, method, data);
        const id = this.commandId++;
        const command = { cmd: normalized.cmd, id };
        if (normalized.data !== null && normalized.data !== undefined) command.data = normalized.data;

        const json = JSON.stringify(command);
        console.log('[USB] →', json);

        // Send command
        if (this.isElectron) {
            const result = await window.electronAPI.writeSerial(json);
            if (!result.success) {
                throw new Error(result.error || 'Failed to write to serial port');
            }
        } else {
            if (!this.writer) {
                throw new Error('Writer not initialized');
            }
            await this.writer.write(json + '\n');
        }

        // Return promise that resolves when response is received
        return new Promise((resolve, reject) => {
            const timeoutMs = this.getCommandTimeoutMs(normalized.cmd);
            const timeout = setTimeout(() => {
                this.responseHandlers.delete(id);
                reject(new Error('Command timeout'));
            }, timeoutMs);

            this.responseHandlers.set(id, (response) => {
                clearTimeout(timeout);
                if (response.status === 'OK') {
                    resolve(response.data || {});
                } else {
                    reject(new Error(response.message || 'Command failed'));
                }
            });
        });
    }

    /**
     * Register event handler
     */
    on(event, handler) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].push(handler);
        }
    }

    /**
     * Unregister event handler
     */
    off(event, handler) {
        if (this.eventHandlers[event]) {
            const index = this.eventHandlers[event].indexOf(handler);
            if (index > -1) {
                this.eventHandlers[event].splice(index, 1);
            }
        }
    }
}

/**
 * Transport Manager - Unified interface for WiFi (SSE) and USB
 */
class TransportManager {
    constructor() {
        this.mode = 'wifi'; // 'wifi' or 'usb'
        this.usb = new USBTransport();
        this.eventSource = null;
    }

    /**
     * Get current mode
     */
    getMode() {
        return this.mode;
    }

    /**
     * Check if USB is supported
     */
    isUSBSupported() {
        return this.usb.isSupported();
    }

    /**
     * Switch to USB mode
     */
    async switchToUSB() {
        // Disconnect WiFi first
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        // Connect USB
        const connected = await this.usb.connect();
        if (connected) {
            this.mode = 'usb';
            console.log('[Transport] Switched to USB mode');
            return true;
        }
        return false;
    }

    /**
     * Switch to WiFi mode
     */
    async switchToWiFi() {
        // Disconnect USB first
        if (this.mode === 'usb') {
            await this.usb.disconnect();
        }

        // Reconnect WiFi SSE
        this.mode = 'wifi';
        console.log('[Transport] Switched to WiFi mode');
        
        // Trigger page reload to reinitialize SSE
        window.location.reload();
    }

    /**
     * Fetch config (unified interface)
     */
    async fetchConfig() {
        if (this.mode === 'usb') {
            return await this.usb.sendCommand('config/get');
        } else {
            const response = await fetch('/config');
            return await response.json();
        }
    }

    /**
     * Update config (unified interface)
     */
    async updateConfig(config) {
        if (this.mode === 'usb') {
            await this.usb.sendCommand('config/set', config);
        } else {
            await fetch('/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
        }
    }

    /**
     * Start timer
     */
    async startTimer() {
        if (this.mode === 'usb') {
            await this.usb.sendCommand('timer/start');
        } else {
            await fetch('/timer/start', { method: 'POST' });
        }
    }

    /**
     * Stop timer
     */
    async stopTimer() {
        if (this.mode === 'usb') {
            await this.usb.sendCommand('timer/stop');
        } else {
            await fetch('/timer/stop', { method: 'POST' });
        }
    }

    /**
     * Start RSSI streaming
     */
    async startRSSI() {
        if (this.mode === 'usb') {
            await this.usb.sendCommand('rssi/start');
        } else {
            await fetch('/timer/rssiStart', { method: 'POST' });
        }
    }

    /**
     * Stop RSSI streaming
     */
    async stopRSSI() {
        if (this.mode === 'usb') {
            await this.usb.sendCommand('rssi/stop');
        } else {
            await fetch('/timer/rssiStop', { method: 'POST' });
        }
    }

    /**
     * Add lap manually
     */
    async addLap(lapTime) {
        if (this.mode === 'usb') {
            await this.usb.sendCommand('timer/addLap', { lapTime });
        } else {
            await fetch('/timer/addLap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lapTime })
            });
        }
    }

    /**
     * Register event handler (works for both modes)
     */
    addEventListener(event, handler) {
        if (this.mode === 'usb') {
            this.usb.on(event, handler);
        } else {
            // For WiFi mode, this should be set up with SSE
            // This will be handled by the existing code
        }
    }

    /**
     * Setup SSE for WiFi mode (call this from main script.js)
     */
    setupSSE(eventSource) {
        this.eventSource = eventSource;
    }
}

// Global transport manager instance
window.transportManager = new TransportManager();
