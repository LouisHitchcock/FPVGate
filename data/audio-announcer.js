/**
 * FPVGate Audio Announcer
 * 
 * Two-tier system for voice announcements:
 * 1. ElevenLabs pre-recorded audio (best quality, instant playback from SD card)
 * 2. Web Speech API (browser TTS fallback, quality varies by device)
 */

class AudioAnnouncer {
    constructor() {
        console.log('[AudioAnnouncer] Initializing...');
        console.log('[AudioAnnouncer] Page origin:', window.location.origin);
        console.log('[AudioAnnouncer] Page host:', window.location.host);
        
        this.audioQueue = [];
        this.isPlaying = false;
        this.audioEnabled = false;
        this.rate = 1.3;  // Faster playback for quicker announcements
        this.volume = 1.0;  // Volume 0.0-1.0
        
        // Voice directory mapping (new canonical names first, legacy names as fallback)
        this.voiceDirectories = {
            'default': ['voice_default_en', 'sounds_default'],   // Sarah (Energetic Female, en)
            'rachel': ['voice_rachel_en', 'sounds_rachel'],      // Rachel (Calm Female, en)
            'adam': ['voice_adam_en', 'sounds_adam'],            // Adam (Deep Male, en)
            'antoni': ['voice_antoni_en', 'sounds_antoni'],      // Antoni (Male, en)
            'matilda': ['voice_matilda_en', 'sounds_matilda'],   // Matilda (Warm Female, en)
            'de': ['voice_german_de', 'voice_de'],               // German
            'es': ['voice_spanish_es', 'voice_es'],              // Spanish
            'fr': ['voice_french_fr', 'voice_fr'],               // French
            'webspeech': []                                      // Web Speech only (no pre-recorded)
        };
        
        // Load selected voice from localStorage
        const storedVoice = localStorage.getItem('selectedVoice') || 'default';
        this.selectedVoice = this.normalizeVoiceSelection(storedVoice);
        if (this.selectedVoice !== storedVoice) {
            localStorage.setItem('selectedVoice', this.selectedVoice);
        }
        console.log('[AudioAnnouncer] Selected voice from localStorage:', this.selectedVoice);
        console.log('[AudioAnnouncer] Voice directories:', this.getVoiceDirectoryCandidates().join(', ') || 'Web Speech only');
        
        // Pre-recorded audio cache
        this.audioCache = new Map();
        this.preloadedAudios = new Set();
        
        // Single reusable Audio element for mobile compatibility
        // Mobile browsers restrict creating new Audio() without user gesture
        this.reusableAudio = null;
        this.audioUnlocked = false;
        
        // Check Web Speech API availability
        this.webSpeechAvailable = 'speechSynthesis' in window;
        if (this.webSpeechAvailable) {
            console.log('[AudioAnnouncer] Web Speech API available');
            // Pre-load voices (some browsers need this)
            speechSynthesis.getVoices();
            if (speechSynthesis.onvoiceschanged !== undefined) {
                speechSynthesis.onvoiceschanged = () => {
                    const voices = speechSynthesis.getVoices();
                    console.log('[AudioAnnouncer] Web Speech voices loaded:', voices.length);
                };
            }
        } else {
            console.warn('[AudioAnnouncer] Web Speech API not available');
        }
        
        console.log('[AudioAnnouncer] Initialized (audio disabled by default, call enable() to activate)');
    }

    normalizeVoiceSelection(voice) {
        const aliases = {
            'piper': 'default',
            'german': 'de',
            'spanish': 'es',
            'french': 'fr',
            'voice_de': 'de',
            'voice_es': 'es',
            'voice_fr': 'fr',
        };
        const normalized = aliases[voice] || voice;
        if (Object.prototype.hasOwnProperty.call(this.voiceDirectories, normalized)) {
            return normalized;
        }
        return 'default';
    }

    getVoiceDirectoryCandidates() {
        const voice = this.normalizeVoiceSelection(this.selectedVoice);
        return this.voiceDirectories[voice] || this.voiceDirectories.default;
    }

    getPrimaryVoiceDirectory() {
        const candidates = this.getVoiceDirectoryCandidates();
        return candidates.length > 0 ? candidates[0] : null;
    }

    async resolveAudioPath(audioPath) {
        if (!audioPath) return null;

        if (await this.hasPrerecordedAudio(audioPath)) {
            return audioPath;
        }

        const candidates = this.getVoiceDirectoryCandidates();
        if (candidates.length < 2) return null;

        const primary = candidates[0];
        const prefix = `${primary}/`;
        if (!audioPath.startsWith(prefix)) return null;

        const filename = audioPath.substring(prefix.length);
        for (let i = 1; i < candidates.length; i++) {
            const fallbackPath = `${candidates[i]}/${filename}`;
            if (await this.hasPrerecordedAudio(fallbackPath)) {
                return fallbackPath;
            }
        }

        return null;
    }

    async playVoiceFile(filename, overlapMs = 50) {
        const candidates = this.getVoiceDirectoryCandidates();
        for (const dir of candidates) {
            const candidatePath = `${dir}/${filename}`;
            if (await this.hasPrerecordedAudio(candidatePath)) {
                await this.playPrerecorded(candidatePath, overlapMs);
                return true;
            }
        }
        return false;
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
     * Uses reusable Audio element on mobile for better compatibility
     * @param {number} overlapMs - Milliseconds to resolve early for crossfade (default: 50ms)
     */
    async playPrerecorded(audioPath, overlapMs = 50) {
        return new Promise((resolve, reject) => {
            // Use reusable audio element if available (mobile compatibility)
            // This avoids creating new Audio() which can fail without user gesture
            const audio = this.reusableAudio || new Audio();
            
            // Reset any previous handlers
            audio.oncanplay = null;
            audio.ontimeupdate = null;
            audio.onended = null;
            audio.onerror = null;
            
            audio.preload = 'auto';
            audio.playbackRate = this.rate;
            audio.volume = this.volume;
            audio.preservesPitch = false;
            
            let resolved = false;
            const overlapSeconds = overlapMs / 1000;
            
            audio.ontimeupdate = () => {
                if (!resolved && audio.duration > 0 && audio.currentTime >= audio.duration - overlapSeconds) {
                    resolved = true;
                    resolve();
                }
            };
            
            audio.onended = () => {
                if (!resolved) {
                    resolved = true;
                    resolve();
                }
            };
            
            audio.onerror = (e) => {
                console.error('[AudioAnnouncer] Error loading/playing audio:', audioPath, e);
                resolved = true;
                reject(e);
            };
            
            // Set source and play
            audio.src = audioPath;
            
            // Play when ready
            const playAudio = () => {
                audio.play().then(() => {
                    console.log('[AudioAnnouncer] Playing:', audioPath);
                }).catch((err) => {
                    console.error('[AudioAnnouncer] Play failed:', audioPath, err.message);
                    if (!resolved) {
                        resolved = true;
                        reject(err);
                    }
                });
            };
            
            // If already ready, play immediately
            if (audio.readyState >= 3) {
                playAudio();
            } else {
                audio.oncanplay = playAudio;
            }
        });
    }

    /**
     * Resolve currently selected UI language for Web Speech
     */
    getCurrentLanguageCode() {
        const i18nLang = (typeof window !== 'undefined' && window.i18n && window.i18n.currentLang)
            ? window.i18n.currentLang
            : null;
        const storedLang = localStorage.getItem('fpvgate_lang');
        const htmlLang = document.documentElement?.lang;
        const browserLang = navigator.language;
        const raw = (i18nLang || storedLang || htmlLang || browserLang || 'en').toString().trim();
        const lang = raw.toLowerCase();

        if (lang.startsWith('zh')) return 'zh-CN';
        if (lang.startsWith('fr')) return 'fr-FR';
        if (lang.startsWith('es')) return 'es-ES';
        if (lang.startsWith('de')) return 'de-DE';
        if (lang.startsWith('en')) return 'en-US';

        return raw;
    }

    /**
     * Find a browser speech voice matching the requested language
     */
    selectWebSpeechVoice(languageCode, voices) {
        if (!voices || voices.length === 0) return null;

        const target = (languageCode || '').toLowerCase();
        const base = target.split('-')[0];

        return (
            voices.find((v) => v.lang && v.lang.toLowerCase() === target) ||
            voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(`${base}-`)) ||
            voices.find((v) => v.lang && v.lang.toLowerCase() === base) ||
            null
        );
    }
    /**
     * Generate speech using Web Speech API
     */
    async playWebSpeech(text) {
        return new Promise((resolve, reject) => {
            if (!('speechSynthesis' in window)) {
                console.error('[AudioAnnouncer] Web Speech API not supported');
                reject(new Error('Web Speech API not supported'));
                return;
            }
            
            const languageCode = this.getCurrentLanguageCode();
            const voices = speechSynthesis.getVoices();
            const matchedVoice = this.selectWebSpeechVoice(languageCode, voices);
            console.log('[AudioAnnouncer] Web Speech voices available:', voices.length, 'target lang:', languageCode);
            
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = this.rate;
            utterance.lang = languageCode;
            if (matchedVoice) {
                utterance.voice = matchedVoice;
                utterance.lang = matchedVoice.lang || languageCode;
                console.log('[AudioAnnouncer] Using Web Speech voice:', matchedVoice.name, matchedVoice.lang);
            } else {
                console.log('[AudioAnnouncer] No exact Web Speech voice match, using browser default for lang:', languageCode);
            }
            
            utterance.onstart = () => {
                console.log('[AudioAnnouncer] Web Speech started speaking:', text);
            };
            
            utterance.onend = () => {
                console.log('[AudioAnnouncer] Web Speech finished speaking');
                resolve();
            };
            
            utterance.onerror = (event) => {
                console.error('[AudioAnnouncer] Web Speech error:', event.error, event);
                reject(new Error('Web Speech error: ' + event.error));
            };
            
            // Add timeout in case speech never starts/ends
            const timeout = setTimeout(() => {
                console.warn('[AudioAnnouncer] Web Speech timeout - speech may have failed silently');
                resolve(); // Resolve anyway to not block the queue
            }, 10000);
            
            utterance.onend = () => {
                clearTimeout(timeout);
                console.log('[AudioAnnouncer] Web Speech finished speaking');
                resolve();
            };
            
            console.log('[AudioAnnouncer] Calling speechSynthesis.speak()...');
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
        
        // Check if Web Speech only mode is selected
        const selectedVoice = this.normalizeVoiceSelection(localStorage.getItem('selectedVoice') || 'default');
        this.selectedVoice = selectedVoice;
        const useWebSpeechOnly = (selectedVoice === 'webspeech');
        
        try {
            // If Web Speech is selected, use it exclusively
            if (useWebSpeechOnly) {
                console.log('[AudioAnnouncer] Web Speech mode selected');
                await this.playWebSpeech(cleanText);
                return;
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
            
            // Format 3: "Pilot, time" (e.g., "Louis, 12.34") - sync mode format
            const pilotTimeMatch = cleanText.match(/^(.+?),\s*([\d.]+)$/);
            if (pilotTimeMatch) {
                const pilot = pilotTimeMatch[1].trim();
                const lapTime = parseFloat(pilotTimeMatch[2]);
                console.log('[AudioAnnouncer] Detected pilot+time format:', pilot, lapTime);
                await this.speakPilotTime(pilot, lapTime);
                return;
            }
            
            // Format 4: "time" only (e.g., "12.34")
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
                const resolvedAudioPath = await this.resolveAudioPath(audioPath);
                if (resolvedAudioPath) {
                    console.log('[AudioAnnouncer] ✓ Playing pre-recorded:', resolvedAudioPath);
                    await this.playPrerecorded(resolvedAudioPath);
                    return;
                } else {
                    console.log('[AudioAnnouncer] ✗ Pre-recorded audio not found in any configured voice directory, trying fallback');
                }
            } else {
                console.log('[AudioAnnouncer] No audio mapping found for:', cleanText);
            }
            
            // Fallback: Web Speech API (for when pre-recorded files are missing)
            if (this.webSpeechAvailable) {
                console.log('[AudioAnnouncer] Fallback: Using Web Speech API:', cleanText);
                await this.playWebSpeech(cleanText);
            } else {
                console.warn('[AudioAnnouncer] No audio method available for:', cleanText);
            }
            
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
        const voiceDir = this.getPrimaryVoiceDirectory();
        if (!voiceDir) return null;
        
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
        
        // Check if Web Speech only mode is selected
        const selectedVoice = this.normalizeVoiceSelection(localStorage.getItem('selectedVoice') || 'default');
        this.selectedVoice = selectedVoice;
        const useWebSpeechOnly = (selectedVoice === 'webspeech');
        
        // If Web Speech mode is selected, use it exclusively
        if (useWebSpeechOnly) {
            const fullText = `${pilot} Lap ${lapNumber}, ${lapTime}`;
            console.log('[AudioAnnouncer] Web Speech mode - speaking complex announcement:', fullText);
            await this.playWebSpeech(fullText);
            return;
        }
        
        // ElevenLabs voice - try pre-recorded files first
        const phoneticInput = document.getElementById('pphonetic');
        const pilotNameInput = document.getElementById('pname');
        const phoneticName = (phoneticInput?.value || pilotNameInput?.value || pilot).toLowerCase().trim();
        const fileName = phoneticName.replace(/\s+/g, '_');
        
        try {
            // Try to use pre-recorded pilot name + lap
            if (await this.playVoiceFile(`${fileName}_lap.mp3`)) {
                console.log('[AudioAnnouncer] Using complex speech with pre-recorded chunks');
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
        
        // Fallback: Use Web Speech API
        const fullText = `${pilot} Lap ${lapNumber}, ${lapTime}`;
        console.log('[AudioAnnouncer] Using Web Speech fallback for:', fullText);
        if (this.webSpeechAvailable) {
            await this.playWebSpeech(fullText);
        }
    }
    
    /**
     * Speak pilot name + time (e.g., "Louis, 12.34") - sync mode format
     * Uses single Web Speech call for fastest announcement
     */
    async speakPilotTime(pilot, lapTime) {
        if (!this.audioEnabled) return;
        
        // Always use single Web Speech call for pilot+time (fastest, no file lookups)
        const fullText = `${pilot}, ${lapTime}`;
        console.log('[AudioAnnouncer] Speaking pilot+time:', fullText);
        if (this.webSpeechAvailable) {
            await this.playWebSpeech(fullText);
        }
    }

    /**
     * Speak lap announcement without pilot name (e.g., "Lap 5, 12.34")
     */
    async speakComplexLapTime(lapNumber, lapTime) {
        if (!this.audioEnabled) return;
        
        // Check if Web Speech only mode is selected
        const selectedVoice = this.normalizeVoiceSelection(localStorage.getItem('selectedVoice') || 'default');
        this.selectedVoice = selectedVoice;
        const useWebSpeechOnly = (selectedVoice === 'webspeech');
        
        // If Web Speech mode is selected, use it exclusively
        if (useWebSpeechOnly) {
            const fullText = `Lap ${lapNumber}, ${lapTime}`;
            console.log('[AudioAnnouncer] Web Speech mode - speaking lap+time:', fullText);
            await this.playWebSpeech(fullText);
            return;
        }
        
        // ElevenLabs voice - try pre-recorded files first
        try {
            // Check if we have pre-recorded "Lap X" file
            if (lapNumber >= 1 && lapNumber <= 50 && await this.playVoiceFile(`lap_${lapNumber}.mp3`)) {
                console.log('[AudioAnnouncer] Using pre-recorded lap number');
                // No pause - immediate transition to lap time
                await this.speakNumber(lapTime);
                return;
            }
        } catch (e) {
            console.error('[AudioAnnouncer] Lap+time speech failed:', e);
        }
        
        // Fallback: Use Web Speech API
        const fullText = `Lap ${lapNumber}, ${lapTime}`;
        console.log('[AudioAnnouncer] Using Web Speech fallback for:', fullText);
        if (this.webSpeechAvailable) {
            await this.playWebSpeech(fullText);
        }
    }

    /**
     * Speak a number naturally (e.g., 11.44 -> "eleven point forty-four")
     * Supports numbers 0-99 as words
     */
    async speakNumber(num) {
        const numStr = num.toString();
        console.log('[AudioAnnouncer] Speaking number:', numStr);
        
        // Check if Web Speech only mode is selected
        const selectedVoice = this.normalizeVoiceSelection(localStorage.getItem('selectedVoice') || 'default');
        this.selectedVoice = selectedVoice;
        const useWebSpeechOnly = (selectedVoice === 'webspeech');
        
        // If Web Speech mode is selected, use it exclusively
        if (useWebSpeechOnly) {
            console.log('[AudioAnnouncer] Web Speech mode - speaking number:', numStr);
            if (this.webSpeechAvailable) {
                await this.playWebSpeech(numStr);
            }
            return;
        }
        // ElevenLabs voice - try pre-recorded number files first
        // Split into whole and decimal parts
        const parts = numStr.split('.');
        const wholePart = parseInt(parts[0]);
        const decimalPart = parts[1];
        
        try {
            // Speak whole number part (0-99 as words)
            if (wholePart >= 0 && wholePart <= 99) {
                if (!(await this.playVoiceFile(`num_${wholePart}.mp3`, 30))) {
                    throw new Error(`Missing pre-recorded number file for ${wholePart}`);
                }
            } else {
                // Fallback: spell out digit by digit for numbers >= 100
                console.log('[AudioAnnouncer] Number >= 100, using digit-by-digit:', wholePart);
                for (const char of parts[0]) {
                    if (!(await this.playVoiceFile(`num_${char}.mp3`, 30))) {
                        throw new Error(`Missing pre-recorded digit file for ${char}`);
                    }
                }
            }
            
            // Speak decimal part if exists
            if (decimalPart) {
                if (!(await this.playVoiceFile('point.mp3', 20))) {
                    throw new Error('Missing pre-recorded point file');
                }
                
                // Handle decimals with leading zeros properly
                // For lap times, we always want to preserve leading zeros (e.g., "01" = "zero one", not "one")
                if (decimalPart.length === 2) {
                    // Two-digit decimal: speak each digit separately to preserve leading zeros
                    const firstDigit = parseInt(decimalPart[0]);
                    const secondDigit = parseInt(decimalPart[1]);
                    
                    // If first digit is 0, we must say it
                    if (firstDigit === 0) {
                        if (!(await this.playVoiceFile('num_0.mp3', 30))) {
                            throw new Error('Missing pre-recorded digit file for 0');
                        }
                        if (!(await this.playVoiceFile(`num_${secondDigit}.mp3`, 30))) {
                            throw new Error(`Missing pre-recorded digit file for ${secondDigit}`);
                        }
                    } else {
                        // Parse as a two-digit number (e.g., "44" -> forty-four)
                        const decimalNum = parseInt(decimalPart);
                        if (!(await this.playVoiceFile(`num_${decimalNum}.mp3`, 30))) {
                            throw new Error(`Missing pre-recorded number file for ${decimalNum}`);
                        }
                    }
                } else if (decimalPart.length === 1) {
                    // Single digit decimal (e.g., "4.5")
                    const digit = parseInt(decimalPart);
                    if (!(await this.playVoiceFile(`num_${digit}.mp3`, 30))) {
                        throw new Error(`Missing pre-recorded digit file for ${digit}`);
                    }
                } else {
                    // More than 2 digits: spell out digit by digit
                    console.log('[AudioAnnouncer] Decimal > 2 digits, using digit-by-digit:', decimalPart);
                    for (const char of decimalPart) {
                        if (!(await this.playVoiceFile(`num_${char}.mp3`, 30))) {
                            throw new Error(`Missing pre-recorded digit file for ${char}`);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[AudioAnnouncer] Error speaking number, fallback to Web Speech:', num, e);
            // Fallback to Web Speech API
            if (this.webSpeechAvailable) {
                await this.playWebSpeech(numStr);
            }
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
        
        try {
            while (this.audioQueue.length > 0 && this.audioEnabled) {
                const text = this.audioQueue.shift();
                try {
                    await this.speak(text);
                } catch (e) {
                    console.error('[AudioAnnouncer] Error in queue processing, continuing:', e);
                    // Continue processing queue even if one item fails
                }
                // No gap between queued announcements for faster playback
            }
        } finally {
            // Always set isPlaying to false, even if there's an error
            this.isPlaying = false;
        }
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
        const normalizedVoice = this.normalizeVoiceSelection(voice);
        console.log('[AudioAnnouncer] Changing voice to:', normalizedVoice);
        this.selectedVoice = normalizedVoice;
        localStorage.setItem('selectedVoice', normalizedVoice);
        
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
        
        // Mobile browsers require audio to be "unlocked" with user interaction
        await this.unlockAudioContextMobile();
        
        // Start keepalive for desktop browsers to prevent cold-start delays
        this.startSpeechKeepalive();
        
        this.processQueue();  // Start processing any queued items
    }
    
    /**
     * Keep speech synthesis engine warm to prevent cold-start delays on desktop
     * Desktop browsers have 2-3 second delays if speech engine goes idle
     */
    startSpeechKeepalive() {
        // Clear any existing keepalive
        if (this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
        }
        
        // Speak silent utterance every 10 seconds when idle
        this.keepaliveInterval = setInterval(() => {
            if (!this.audioEnabled || this.isPlaying || this.audioQueue.length > 0) {
                return; // Don't interfere with actual speech
            }
            
            // Speak empty/silent utterance to keep engine warm
            if ('speechSynthesis' in window) {
                const silentUtterance = new SpeechSynthesisUtterance('');
                silentUtterance.volume = 0;
                speechSynthesis.speak(silentUtterance);
            }
        }, 10000);
        
        console.log('[AudioAnnouncer] Speech keepalive started');
    }
    
    /**
     * Unlock audio context for mobile browsers
     * Mobile browsers require user interaction before playing audio
     */
    async unlockAudioContextMobile() {
        // Detect mobile/touch devices (broader detection than just iOS)
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                        ('ontouchstart' in window);
        
        console.log('[AudioAnnouncer] Mobile detection:', isMobile, 'UA:', navigator.userAgent.substring(0, 50));
        console.log('[AudioAnnouncer] Origin:', window.location.origin, 'Host:', window.location.host);
        
        // Always try to unlock on mobile, but also try on desktop for safety
        console.log('[AudioAnnouncer] Attempting audio unlock...');
        
        try {
            // Create the reusable Audio element during user gesture
            // This is critical for mobile - Audio elements created during user gestures
            // can be reused for playback later without additional gestures
            if (!this.reusableAudio) {
                this.reusableAudio = new Audio();
                console.log('[AudioAnnouncer] Created reusable Audio element');
            }
            
            // Unlock by playing a silent sound
            this.reusableAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
            this.reusableAudio.volume = 0.01; // Tiny volume instead of 0 (some browsers ignore 0)
            
            // Try to play the reusable element to unlock it
            const playResult = await this.reusableAudio.play().then(() => {
                this.audioUnlocked = true;
                return 'success';
            }).catch(err => {
                // Even if play fails, mark as attempted so we don't keep trying
                this.audioUnlocked = true; // Treat as "attempted" - Web Speech might still work
                return err.message || 'unknown error';
            });
            console.log('[AudioAnnouncer] Reusable audio unlock result:', playResult);
            
            // For Web Speech API - try to initialize
            if ('speechSynthesis' in window) {
                // Cancel any pending speech first
                speechSynthesis.cancel();
                
                // Load voices (required for iOS)
                let voices = speechSynthesis.getVoices();
                console.log('[AudioAnnouncer] Initial voices count:', voices.length);
                
                if (voices.length === 0) {
                    // Voices not loaded yet, wait for them
                    await new Promise(resolve => {
                        const voiceTimeout = setTimeout(() => {
                            console.warn('[AudioAnnouncer] Voice loading timeout (1.5s)');
                            resolve();
                        }, 1500);
                        
                        if (speechSynthesis.onvoiceschanged !== undefined) {
                            speechSynthesis.onvoiceschanged = () => {
                                clearTimeout(voiceTimeout);
                                resolve();
                            };
                        } else {
                            clearTimeout(voiceTimeout);
                            resolve();
                        }
                    });
                    
                    voices = speechSynthesis.getVoices();
                }
                
                console.log('[AudioAnnouncer] Final voices count:', voices.length);
                
                // Try a silent utterance to fully unlock Web Speech
                if (voices.length > 0) {
                    const silentUtterance = new SpeechSynthesisUtterance('');
                    silentUtterance.volume = 0;
                    speechSynthesis.speak(silentUtterance);
                    console.log('[AudioAnnouncer] Silent utterance queued for unlock');
                }
            }
            
            console.log('[AudioAnnouncer] Audio unlock completed');
        } catch (error) {
            console.warn('[AudioAnnouncer] Audio unlock error:', error);
        }
    }

    /**
     * Disable audio announcements
     */
    disable() {
        this.audioEnabled = false;
        this.audioQueue = [];
        
        // Stop keepalive
        if (this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
            this.keepaliveInterval = null;
        }
        
        // Stop any ongoing speech
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
        }
    }

    /**
     * Set volume for all audio (0.0-1.0)
     */
    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        console.log('[AudioAnnouncer] Volume set to:', this.volume);
        
        // Update cached audio elements
        for (const audio of this.audioCache.values()) {
            audio.volume = this.volume;
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
        const testFiles = [];
        const voiceDirs = this.getVoiceDirectoryCandidates();
        for (const dir of voiceDirs) {
            testFiles.push(
                `${dir}/arm_your_quad.mp3`,
                `${dir}/starting_tone.mp3`,
                `${dir}/race_complete.mp3`,
                `${dir}/race_stopped.mp3`,
                `${dir}/lap_1.mp3`,
                `${dir}/lap_5.mp3`,
                `${dir}/num_0.mp3`,
                `${dir}/num_1.mp3`,
                `${dir}/point.mp3`
            );
        }
        
        const phoneticInput = document.getElementById('pphonetic');
        const pilotNameInput = document.getElementById('pname');
        const phoneticName = (phoneticInput?.value || pilotNameInput?.value || '').toLowerCase().trim();
        if (phoneticName) {
            const fileName = phoneticName.replace(/\s+/g, '_');
            for (const dir of voiceDirs) {
                testFiles.push(`${dir}/${fileName}_lap.mp3`);
            }
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
