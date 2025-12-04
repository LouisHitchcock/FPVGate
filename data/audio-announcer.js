/**
 * FPVGate Hybrid Audio Announcer
 * 
 * Three-tier fallback system for voice announcements:
 * 1. ElevenLabs pre-recorded audio (best quality, instant)
 * 2. Piper TTS via WASM (good quality, slight latency)
 * 3. Web Speech API (fallback, varies by browser)
 */

class AudioAnnouncer {
    constructor() {
        console.log('[AudioAnnouncer] Initializing...');
        this.audioQueue = [];
        this.isPlaying = false;
        this.audioEnabled = false;
        this.rate = 1.3;  // Faster playback for quicker announcements
        this.piperTTS = null;
        this.piperLoaded = false;
        this.ttsEngine = 'piper';  // Default to Piper TTS
        
        // Voice directory mapping
        this.voiceDirectories = {
            'default': 'sounds_default',  // Sarah (Energetic Female)
            'rachel': 'sounds_rachel',    // Rachel (Calm Female)
            'adam': 'sounds_adam',        // Adam (Deep Male)
            'antoni': 'sounds_antoni',    // Antoni (Male)
            'piper': 'sounds'             // PiperTTS uses fallback (no pre-recorded)
        };
        
        // Load selected voice from localStorage
        this.selectedVoice = localStorage.getItem('selectedVoice') || 'default';
        console.log('[AudioAnnouncer] Selected voice:', this.selectedVoice);
        
        // Pre-recorded audio cache
        this.audioCache = new Map();
        this.preloadedAudios = new Set();
        
        // Load TTS engine preference
        const savedEngine = localStorage.getItem('ttsEngine');
        if (savedEngine) {
            this.ttsEngine = savedEngine;
        }
        
        // Initialize Piper TTS
        this.initPiper();
        console.log('[AudioAnnouncer] Initialized (audio disabled by default, call enable() to activate)');
        console.log('[AudioAnnouncer] TTS engine:', this.ttsEngine);
    }

    /**
     * Initialize Piper TTS (async, non-blocking)
     */
    async initPiper() {
        try {
            console.log('[AudioAnnouncer] Loading Piper TTS...');
            
            // Check if we have the piper-tts-web library loaded
            if (typeof PiperTTS === 'undefined') {
                console.warn('[AudioAnnouncer] Piper TTS library not found. Will fallback to Web Speech API.');
                return;
            }
            
            // Initialize Piper TTS with medium-quality voice
            this.piperTTS = await PiperTTS.create({
                voiceId: 'en_US-hfc_female-medium',  // High-quality female voice
                wasmPath: '/piper/',  // Path to WASM files
            });
            
            this.piperLoaded = true;
            console.log('[AudioAnnouncer] Piper TTS loaded successfully!');
            
        } catch (error) {
            console.warn('[AudioAnnouncer] Piper TTS failed to load:', error);
            console.log('[AudioAnnouncer] Will use Web Speech API fallback');
        }
    }

    /**
     * Check if pre-recorded audio exists for this phrase
     */
    async hasPrerecordedAudio(audioPath) {
        if (this.preloadedAudios.has(audioPath)) {
            return true;
        }
        
        try {
            // Use GET instead of HEAD for better compatibility
            const response = await fetch(audioPath, { method: 'GET', cache: 'no-cache' });
            if (response.ok) {
                this.preloadedAudios.add(audioPath);
                console.log('[AudioAnnouncer] Verified audio file exists:', audioPath);
                return true;
            } else {
                console.warn('[AudioAnnouncer] Audio file not found (status ' + response.status + '):', audioPath);
            }
        } catch (e) {
            console.warn('[AudioAnnouncer] Error checking audio file:', audioPath, e);
        }
        
        return false;
    }

    /**
     * Play pre-recorded audio file with optimized playback and instant transitions
     */
    async playPrerecorded(audioPath) {
        return new Promise((resolve, reject) => {
            // Check cache first
            if (this.audioCache.has(audioPath)) {
                const audio = this.audioCache.get(audioPath).cloneNode();
                audio.playbackRate = this.rate;
                audio.preservesPitch = false; // Better quality at higher speeds
                
                // Resolve slightly before audio ends for instant transition
                let resolved = false;
                audio.ontimeupdate = () => {
                    if (!resolved && audio.duration > 0 && audio.currentTime >= audio.duration - 0.05) {
                        resolved = true;
                        resolve();
                    }
                };
                
                audio.onended = () => {
                    if (!resolved) resolve();
                };
                
                audio.onerror = (e) => {
                    console.error('[AudioAnnouncer] Error playing cached audio:', audioPath, e);
                    reject(e);
                };
                audio.play().catch((err) => {
                    console.error('[AudioAnnouncer] Play failed (cached):', audioPath, err);
                    reject(err);
                });
                return;
            }
            
            // Load and cache - preload='auto' for faster loading
            const audio = new Audio();
            audio.preload = 'auto';
            audio.playbackRate = this.rate;
            audio.preservesPitch = false;
            audio.src = audioPath;
            
            let resolved = false;
            
            audio.ontimeupdate = () => {
                if (!resolved && audio.duration > 0 && audio.currentTime >= audio.duration - 0.05) {
                    resolved = true;
                    this.audioCache.set(audioPath, audio);
                    resolve();
                }
            };
            
            audio.onended = () => {
                if (!resolved) {
                    this.audioCache.set(audioPath, audio);
                    resolve();
                }
            };
            
            audio.onerror = (e) => {
                console.error('[AudioAnnouncer] Error loading/playing audio:', audioPath, e);
                reject(e);
            };
            
            // Play as soon as enough data is buffered
            audio.oncanplay = () => {
                audio.play().catch((err) => {
                    console.error('[AudioAnnouncer] Play failed:', audioPath, err);
                    reject(err);
                });
            };
        });
    }

    /**
     * Generate speech using Piper TTS
     */
    async playPiper(text) {
        if (!this.piperLoaded || !this.piperTTS) {
            throw new Error('Piper TTS not available');
        }
        
        return new Promise(async (resolve, reject) => {
            try {
                const wav = await this.piperTTS.predict({ text });
                const audio = new Audio();
                audio.src = URL.createObjectURL(wav);
                audio.playbackRate = this.rate;
                audio.onended = () => {
                    URL.revokeObjectURL(audio.src);
                    resolve();
                };
                audio.onerror = reject;
                await audio.play();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Generate speech using Web Speech API (fallback)
     */
    async playWebSpeech(text) {
        return new Promise((resolve, reject) => {
            if (!('speechSynthesis' in window)) {
                reject(new Error('Web Speech API not supported'));
                return;
            }
            
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = this.rate;
            utterance.onend = resolve;
            utterance.onerror = reject;
            
            speechSynthesis.speak(utterance);
        });
    }

    /**
     * Main speak function with intelligent fallback
     */
    async speak(text) {
        if (!this.audioEnabled) {
            console.log('[AudioAnnouncer] Audio disabled, skipping:', text);
            return;
        }
        
        // Strip HTML tags and normalize
        const cleanText = text.replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ');
        
        if (!cleanText) {
            console.warn('[AudioAnnouncer] Empty text after cleaning:', text);
            return;
        }
        
        console.log('[AudioAnnouncer] Speaking:', cleanText);
        
        // Check if PiperTTS is selected as primary voice
        const selectedVoice = localStorage.getItem('selectedVoice') || 'default';
        const usePiperExclusively = (selectedVoice === 'piper');
        
        try {
            // If PiperTTS is selected, use it exclusively without trying pre-recorded files
            if (usePiperExclusively) {
                console.log('[AudioAnnouncer] PiperTTS selected - using exclusively');
                if (this.piperLoaded) {
                    await this.playPiper(cleanText);
                    return;
                } else {
                    console.warn('[AudioAnnouncer] PiperTTS not loaded, fallback to Web Speech');
                    await this.playWebSpeech(cleanText);
                    return;
                }
            }
            
            // ElevenLabs voice selected - try pre-recorded files first
            // Check for different lap announcement formats
            // Format 1: "Pilot Lap X, time" (e.g., "Louis Lap 5, 12.34")
            const fullFormatMatch = cleanText.match(/^(.+?)\s+lap\s+(\d+)\s*,\s*([\d.]+)$/i);
            if (fullFormatMatch) {
                const pilot = fullFormatMatch[1].trim();
                const lapNumber = parseInt(fullFormatMatch[2]);
                const lapTime = parseFloat(fullFormatMatch[3]);
                console.log('[AudioAnnouncer] Detected full format lap announcement:', pilot, lapNumber, lapTime);
                await this.speakComplexWithPilot(pilot, lapNumber, lapTime);
                return;
            }
            
            // Format 2: "Lap X, time" (e.g., "Lap 5, 12.34")
            const lapTimeFormatMatch = cleanText.match(/^lap\s+(\d+)\s*,\s*([\d.]+)$/i);
            if (lapTimeFormatMatch) {
                const lapNumber = parseInt(lapTimeFormatMatch[1]);
                const lapTime = parseFloat(lapTimeFormatMatch[2]);
                console.log('[AudioAnnouncer] Detected lap+time format:', lapNumber, lapTime);
                await this.speakComplexLapTime(lapNumber, lapTime);
                return;
            }
            
            // Format 3: "time" only (e.g., "12.34")
            const timeOnlyMatch = cleanText.match(/^([\d.]+)$/);
            if (timeOnlyMatch) {
                const lapTime = parseFloat(timeOnlyMatch[1]);
                console.log('[AudioAnnouncer] Detected time-only format:', lapTime);
                await this.speakNumber(lapTime);
                return;
            }
            
            // Try pre-recorded audio (ElevenLabs)
            const audioPath = this.mapTextToAudio(cleanText);
            if (audioPath) {
                console.log('[AudioAnnouncer] Mapped to audio path:', audioPath);
                if (await this.hasPrerecordedAudio(audioPath)) {
                    console.log('[AudioAnnouncer] ✓ Playing pre-recorded:', audioPath);
                    await this.playPrerecorded(audioPath);
                    return;
                } else {
                    console.log('[AudioAnnouncer] ✗ Pre-recorded audio not found, trying fallback');
                }
            } else {
                console.log('[AudioAnnouncer] No audio mapping found for:', cleanText);
            }
            
            // Fallback to Piper TTS (for ElevenLabs voices when files missing)
            if (this.piperLoaded) {
                console.log('[AudioAnnouncer] Fallback: Generating with Piper TTS:', cleanText);
                await this.playPiper(cleanText);
                return;
            }
            
            // Final fallback: Web Speech API
            console.log('[AudioAnnouncer] Fallback: Using Web Speech API:', cleanText);
            await this.playWebSpeech(cleanText);
            
        } catch (error) {
            console.error('[AudioAnnouncer] Speech error:', error, 'for text:', cleanText);
        }
    }

    /**
     * Map text to pre-recorded audio file path
     * Returns null if no mapping exists
     */
    mapTextToAudio(text) {
        // Get voice directory based on selection
        const voiceDir = this.voiceDirectories[this.selectedVoice] || 'sounds_default';
        
        // Normalize text: lowercase, trim, remove extra whitespace
        const lower = text.toLowerCase().trim().replace(/\s+/g, ' ');
        
        // Race control phrases (exact matches)
        if (lower === 'arm your quad') return `${voiceDir}/arm_your_quad.mp3`;
        if (lower === 'starting on the tone in less than five') return `${voiceDir}/starting_tone.mp3`;
        if (lower === 'race complete') return `${voiceDir}/race_complete.mp3`;
        if (lower === 'race stopped') return `${voiceDir}/race_stopped.mp3`;
        if (lower.includes('gate 1')) return `${voiceDir}/gate_1.mp3`;
        
        // Test voice
        if (lower.startsWith('testing sound for pilot')) {
            const phoneticInput = document.getElementById('pphonetic');
            const pilotNameInput = document.getElementById('pname');
            const pilotName = (pilotNameInput?.value || '').toLowerCase().trim();
            if (pilotName) {
                return `${voiceDir}/test_sound_${pilotName}.mp3`;
            }
        }
        
        // Check for lap patterns (e.g., "lap 1", "lap 5", "pilot lap 5", etc.)
        // This handles: "lap 5", "pilot lap 5", "pilot lap 5, 12.34", etc.
        const lapMatch = lower.match(/lap\s+(\d+)/);
        if (lapMatch) {
            const lapNum = parseInt(lapMatch[1]);
            if (lapNum >= 1 && lapNum <= 50) {
                // Check if this is a simple "lap X" without pilot name
                if (lower === `lap ${lapNum}` || lower.startsWith(`lap ${lapNum}`)) {
                    return `${voiceDir}/lap_${lapNum}.mp3`;
                }
            }
        }
        
        // Pilot-specific phrases (configurable)
        const phoneticInput = document.getElementById('pphonetic');
        const pilotNameInput = document.getElementById('pname');
        const phoneticName = (phoneticInput?.value || pilotNameInput?.value || '').toLowerCase().trim();
        
        if (phoneticName) {
            const fileName = phoneticName.replace(/\s+/g, '_');
            
            // Check for pilot name + lap patterns
            if (lower.includes(phoneticName)) {
                if (lower.includes('2 laps') || lower.includes('2laps')) {
                    return `${voiceDir}/${fileName}_2laps.mp3`;
                }
                if (lower.includes('3 laps') || lower.includes('3laps')) {
                    return `${voiceDir}/${fileName}_3laps.mp3`;
                }
                if (lower.includes('lap') && !lower.match(/lap\s+\d+/)) {
                    // "pilot lap" but not "pilot lap 5"
                    return `${voiceDir}/${fileName}_lap.mp3`;
                }
            }
        }
        
        return null;  // No pre-recorded audio available
    }

    /**
     * Speak complex announcement with pilot name (e.g., "Louis Lap 5, 12.34")
     * Breaks it into pre-recorded chunks when possible
     */
    async speakComplexWithPilot(pilot, lapNumber, lapTime) {
        if (!this.audioEnabled) return;
        
        // Check if PiperTTS is selected as primary voice
        const selectedVoice = localStorage.getItem('selectedVoice') || 'default';
        const usePiperExclusively = (selectedVoice === 'piper');
        
        // If PiperTTS is selected, use it exclusively
        if (usePiperExclusively) {
            const fullText = `${pilot} Lap ${lapNumber}, ${lapTime}`;
            console.log('[AudioAnnouncer] PiperTTS selected - speaking complex announcement exclusively:', fullText);
            await this.useTtsFallback(fullText);
            return;
        }
        
        // ElevenLabs voice - try pre-recorded files first
        const phoneticInput = document.getElementById('pphonetic');
        const pilotNameInput = document.getElementById('pname');
        const phoneticName = (phoneticInput?.value || pilotNameInput?.value || pilot).toLowerCase().trim();
        const fileName = phoneticName.replace(/\s+/g, '_');
        
        // Get voice directory
        const voiceDir = this.voiceDirectories[this.selectedVoice] || 'sounds_default';
        
        try {
            // Try to use pre-recorded pilot name + lap
            const pilotLapPath = `${voiceDir}/${fileName}_lap.mp3`;
            console.log('[AudioAnnouncer] Trying complex speech with pilot:', pilotLapPath);
            if (await this.hasPrerecordedAudio(pilotLapPath)) {
                console.log('[AudioAnnouncer] Using complex speech with pre-recorded chunks');
                await this.playPrerecorded(pilotLapPath);
                await this.speakNumber(lapNumber);
                // No pause - immediate transition to lap time
                await this.speakNumber(lapTime);
                return;
            } else {
                console.log('[AudioAnnouncer] Pilot-specific audio not found, using fallback');
            }
        } catch (e) {
            console.error('[AudioAnnouncer] Complex speech with pilot failed:', e);
        }
        
        // Fallback: Use TTS directly (NOT speak() to avoid infinite recursion)
        const fullText = `${pilot} Lap ${lapNumber}, ${lapTime}`;
        console.log('[AudioAnnouncer] Using TTS fallback for:', fullText);
        await this.useTtsFallback(fullText);
    }
    
    /**
     * Speak lap announcement without pilot name (e.g., "Lap 5, 12.34")
     */
    async speakComplexLapTime(lapNumber, lapTime) {
        if (!this.audioEnabled) return;
        
        // Check if PiperTTS is selected as primary voice
        const selectedVoice = localStorage.getItem('selectedVoice') || 'default';
        const usePiperExclusively = (selectedVoice === 'piper');
        
        // If PiperTTS is selected, use it exclusively
        if (usePiperExclusively) {
            const fullText = `Lap ${lapNumber}, ${lapTime}`;
            console.log('[AudioAnnouncer] PiperTTS selected - speaking lap+time exclusively:', fullText);
            await this.useTtsFallback(fullText);
            return;
        }
        
        // Get voice directory
        const voiceDir = this.voiceDirectories[this.selectedVoice] || 'sounds_default';
        
        // ElevenLabs voice - try pre-recorded files first
        try {
            // Check if we have pre-recorded "Lap X" file
            const lapPath = `${voiceDir}/lap_${lapNumber}.mp3`;
            if (lapNumber >= 1 && lapNumber <= 50 && await this.hasPrerecordedAudio(lapPath)) {
                console.log('[AudioAnnouncer] Using pre-recorded lap number:', lapPath);
                await this.playPrerecorded(lapPath);
                // No pause - immediate transition to lap time
                await this.speakNumber(lapTime);
                return;
            }
        } catch (e) {
            console.error('[AudioAnnouncer] Lap+time speech failed:', e);
        }
        
        // Fallback: Use TTS directly (NOT speak() to avoid infinite recursion)
        const fullText = `Lap ${lapNumber}, ${lapTime}`;
        console.log('[AudioAnnouncer] Using TTS fallback for:', fullText);
        await this.useTtsFallback(fullText);
    }

    /**
     * Use TTS fallback based on user preference
     */
    async useTtsFallback(text) {
        if (this.ttsEngine === 'piper' && this.piperLoaded) {
            await this.playPiper(text);
        } else if (this.ttsEngine === 'webspeech' || !this.piperLoaded) {
            await this.playWebSpeech(text);
        }
    }

    /**
     * Set TTS engine preference
     */
    setTtsEngine(engine) {
        this.ttsEngine = engine;
        console.log('[AudioAnnouncer] TTS engine set to:', engine);
    }

    /**
     * Speak a number naturally (e.g., 11.44 -> "eleven point forty-four")
     * Supports numbers 0-99 as words
     */
    async speakNumber(num) {
        const numStr = num.toString();
        console.log('[AudioAnnouncer] Speaking number:', numStr);
        
        // Check if PiperTTS is selected as primary voice
        const selectedVoice = localStorage.getItem('selectedVoice') || 'default';
        const usePiperExclusively = (selectedVoice === 'piper');
        
        // If PiperTTS is selected, use it exclusively
        if (usePiperExclusively) {
            console.log('[AudioAnnouncer] PiperTTS selected - speaking number exclusively:', numStr);
            await this.useTtsFallback(numStr);
            return;
        }
        
        // Get voice directory
        const voiceDir = this.voiceDirectories[this.selectedVoice] || 'sounds_default';
        
        // ElevenLabs voice - try pre-recorded number files first
        // Split into whole and decimal parts
        const parts = numStr.split('.');
        const wholePart = parseInt(parts[0]);
        const decimalPart = parts[1];
        
        try {
            // Speak whole number part (0-99 as words)
            if (wholePart >= 0 && wholePart <= 99) {
                await this.playPrerecorded(`${voiceDir}/num_${wholePart}.mp3`);
            } else {
                // Fallback: spell out digit by digit for numbers >= 100
                console.log('[AudioAnnouncer] Number >= 100, using digit-by-digit:', wholePart);
                for (const char of parts[0]) {
                    await this.playPrerecorded(`${voiceDir}/num_${char}.mp3`);
                }
            }
            
            // Speak decimal part if exists
            if (decimalPart) {
                await this.playPrerecorded(`${voiceDir}/point.mp3`);
                
                // Parse decimal as a number (e.g., "44" -> 44, "04" -> 4)
                const decimalNum = parseInt(decimalPart);
                
                if (decimalNum >= 0 && decimalNum <= 99) {
                    await this.playPrerecorded(`${voiceDir}/num_${decimalNum}.mp3`);
                } else {
                    // Fallback: spell out digit by digit
                    console.log('[AudioAnnouncer] Decimal >= 100, using digit-by-digit:', decimalNum);
                    for (const char of decimalPart) {
                        await this.playPrerecorded(`${voiceDir}/num_${char}.mp3`);
                    }
                }
            }
        } catch (e) {
            console.warn('[AudioAnnouncer] Error speaking number, fallback to TTS:', num, e);
            // Fallback to TTS instead of trying to piece together files
            await this.useTtsFallback(numStr);
        }
    }

    /**
     * Queue speech to prevent overlapping
     */
    queueSpeak(text) {
        if (!this.audioEnabled) {
            console.log('[AudioAnnouncer] Audio disabled, not queuing:', text);
            return;
        }
        this.audioQueue.push(text);
        console.log('[AudioAnnouncer] Queued speech:', text, '(queue length:', this.audioQueue.length + ')');
        this.processQueue();
    }

    /**
     * Process the speech queue
     */
    async processQueue() {
        if (this.isPlaying || this.audioQueue.length === 0) {
            return;
        }
        
        this.isPlaying = true;
        
        while (this.audioQueue.length > 0 && this.audioEnabled) {
            const text = this.audioQueue.shift();
            await this.speak(text);
            // No gap between queued announcements for faster playback
        }
        
        this.isPlaying = false;
    }

    /**
     * Set speech rate (0.1 to 2.0)
     */
    setRate(rate) {
        this.rate = parseFloat(rate);
    }
    
    /**
     * Change voice and clear audio cache
     */
    setVoice(voice) {
        console.log('[AudioAnnouncer] Changing voice to:', voice);
        this.selectedVoice = voice;
        localStorage.setItem('selectedVoice', voice);
        
        // Clear audio cache so new voice files are loaded
        this.audioCache.clear();
        this.preloadedAudios.clear();
        
        console.log('[AudioAnnouncer] Voice changed, cache cleared');
    }

    /**
     * Enable audio announcements
     */
    async enable() {
        this.audioEnabled = true;
        console.log('[AudioAnnouncer] Audio enabled');
        
        // iOS/Safari requires audio to be "unlocked" with user interaction
        await this.unlockAudioContextiOS();
        
        this.processQueue();  // Start processing any queued items
    }
    
    /**
     * Unlock audio context for iOS/Safari
     * Safari requires user interaction before playing audio
     */
    async unlockAudioContextiOS() {
        // Detect iOS/Safari
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        
        if (!isIOS && !isSafari) {
            return; // Not iOS/Safari, no need to unlock
        }
        
        console.log('[AudioAnnouncer] iOS/Safari detected, unlocking audio...');
        
        try {
            // Create and play a silent audio to unlock iOS audio
            const silentAudio = new Audio();
            silentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
            silentAudio.volume = 0;
            
            // Try to play
            await silentAudio.play().catch(err => {
                console.warn('[AudioAnnouncer] iOS audio unlock play failed (expected on first try):', err);
            });
            
            // For PiperTTS - unlock Web Audio API AudioContext
            if (this.piperTTS && this.piperTTS.audioContext) {
                if (this.piperTTS.audioContext.state === 'suspended') {
                    await this.piperTTS.audioContext.resume();
                    console.log('[AudioAnnouncer] PiperTTS AudioContext resumed');
                }
            }
            
            // For Web Speech API - try to initialize
            if ('speechSynthesis' in window) {
                // Load voices (required for iOS)
                const voices = speechSynthesis.getVoices();
                if (voices.length === 0) {
                    // Voices not loaded yet, wait for them
                    await new Promise(resolve => {
                        if (speechSynthesis.onvoiceschanged !== undefined) {
                            speechSynthesis.onvoiceschanged = resolve;
                            setTimeout(resolve, 1000); // Timeout after 1s
                        } else {
                            resolve();
                        }
                    });
                }
            }
            
            console.log('[AudioAnnouncer] iOS/Safari audio unlocked successfully');
        } catch (error) {
            console.warn('[AudioAnnouncer] iOS audio unlock error:', error);
        }
    }

    /**
     * Disable audio announcements
     */
    disable() {
        this.audioEnabled = false;
        this.audioQueue = [];
        
        // Stop any ongoing speech
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
    }

    /**
     * Check if currently speaking
     */
    isSpeaking() {
        return this.isPlaying;
    }

    /**
     * Clear the queue
     */
    clearQueue() {
        this.audioQueue = [];
    }

    /**
     * Helper: sleep function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Test function to verify audio files are accessible
     * Call this from browser console: audioAnnouncer.testAudioFiles()
     */
    async testAudioFiles() {
        console.log('[AudioAnnouncer] Testing audio file accessibility...');
        const testFiles = [
            'sounds/arm_your_quad.mp3',
            'sounds/starting_tone.mp3',
            'sounds/race_complete.mp3',
            'sounds/race_stopped.mp3',
            'sounds/hole_shot.mp3',
            'sounds/lap_1.mp3',
            'sounds/lap_5.mp3',
            'sounds/num_0.mp3',
            'sounds/num_1.mp3',
            'sounds/point.mp3',
            'sounds/comma.mp3'
        ];
        
        const phoneticInput = document.getElementById('pphonetic');
        const pilotNameInput = document.getElementById('pname');
        const phoneticName = (phoneticInput?.value || pilotNameInput?.value || '').toLowerCase().trim();
        if (phoneticName) {
            const fileName = phoneticName.replace(/\s+/g, '_');
            testFiles.push(`sounds/${fileName}_lap.mp3`);
        }
        
        let found = 0;
        let missing = 0;
        
        for (const file of testFiles) {
            const exists = await this.hasPrerecordedAudio(file);
            if (exists) {
                found++;
                console.log('✓', file);
            } else {
                missing++;
                console.error('✗', file, '- NOT FOUND');
            }
        }
        
        console.log(`[AudioAnnouncer] Test complete: ${found} found, ${missing} missing`);
        return { found, missing, total: testFiles.length };
    }
}

// Export for use in script.js
window.AudioAnnouncer = AudioAnnouncer;
