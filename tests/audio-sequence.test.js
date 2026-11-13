const fs=require('fs'),path=require('path'),vm=require('vm');
const {Blob}=require('buffer');
const source=fs.readFileSync(path.join(__dirname,'../data/audio-announcer.js'),'utf8');
function setup(){
 let voice='default';const revoked=[];
 const ctx={window:{location:{origin:'http://gate',host:'gate'}},console:{log(){},warn(){},error(){}},localStorage:{getItem:()=>voice,setItem(){}},URL:{createObjectURL:jest.fn(()=> 'blob:joined'),revokeObjectURL:u=>revoked.push(u)},Blob,AbortController,setTimeout,clearTimeout,fetch:jest.fn()};
 vm.createContext(ctx);vm.runInContext(source,ctx);const a=new ctx.window.AudioAnnouncer();a.audioEnabled=true;a.webSpeechAvailable=true;
 return {a,ctx,revoked,voice:v=>{voice=v;a.setVoice(v)}};
}
test.each([['3.44',['num_3.mp3','point.mp3','num_44.mp3']],['3.04',['num_3.mp3','point.mp3','num_0.mp3','num_4.mp3']],['3.40',['num_3.mp3','point.mp3','num_40.mp3']],['103.5',['num_1.mp3','num_0.mp3','num_3.mp3','point.mp3','num_5.mp3']]])('number sequence preserves %s', (value,files)=>{expect(setup().a.numberFiles(value)).toEqual(files)});
test('warm lap is one audio play with no word downloads and URL cleanup',async()=>{
 const {a,ctx,revoked}=setup();for(const f of ['lap_1.mp3','num_3.mp3','point.mp3','num_44.mp3'])a.decodedClips.set('voice_default_en/'+f,{sampleRate:22050,samples:new Float32Array([.1,.2])});
 a.playPrerecorded=jest.fn(async()=>{});a.playWebSpeech=jest.fn();await a.speakComplexLapTime(1,3.44);
 expect(a.playPrerecorded).toHaveBeenCalledTimes(1);expect(a.playPrerecorded).toHaveBeenCalledWith('assembled-lap',0,'blob:joined');expect(a.playWebSpeech).not.toHaveBeenCalled();expect(ctx.fetch).not.toHaveBeenCalled();expect(revoked).toEqual(['blob:joined']);
});
test('cold/missing phrase uses one full TTS call, never partial pack speech',async()=>{
 const {a}=setup();a.playPrerecorded=jest.fn();a.playWebSpeech=jest.fn();await a.speakComplexLapTime(1,3.44);expect(a.playPrerecorded).not.toHaveBeenCalled();expect(a.playWebSpeech).toHaveBeenCalledWith('Lap 1, 3.44');
});
test('WAV has contiguous samples and valid PCM header',async()=>{
 const {a}=setup();const wav=a.sequenceWav([{sampleRate:22050,samples:new Float32Array([.5,-.5])},{sampleRate:22050,samples:new Float32Array([.25])}]);const v=new DataView(await wav.arrayBuffer());expect(v.byteLength).toBe(50);expect(v.getUint32(24,true)).toBe(22050);expect(v.getUint32(40,true)).toBe(6);expect(v.getInt16(44,true)).toBe(16383);expect(v.getInt16(46,true)).toBe(-16384);expect(v.getInt16(48,true)).toBe(8191);
});
test('decoder trims only outer silence with consonant safety margins',async()=>{
 const {a,ctx}=setup();const samples=new Float32Array(1000);samples.fill(.2,200,800);samples.fill(0,400,450);
 ctx.window.OfflineAudioContext=class{async decodeAudioData(){return {length:1000,numberOfChannels:1,sampleRate:1000,getChannelData:()=>samples}}};a.resolveAudioPath=async p=>p;a.audioSources.set('voice_default_en/test.mp3',{blob:new Blob(['mp3'])});
 const clip=await a.decodeVoiceClip('test.mp3');expect(clip.samples.length).toBe(630);expect(clip.samples[15]).toBeCloseTo(.2);expect(clip.samples[215]).toBe(0);
});
test('voice change discards in-flight decoded audio',async()=>{
 const {a,ctx,voice}=setup();let finish;ctx.window.OfflineAudioContext=class{decodeAudioData(){return new Promise(r=>{finish=r})}};a.resolveAudioPath=async p=>p;a.audioSources.set('voice_default_en/test.mp3',{blob:new Blob(['mp3']),url:'blob:test'});const pending=a.decodeVoiceClip('test.mp3');while(!finish)await Promise.resolve();voice('rachel');finish({length:2,numberOfChannels:1,sampleRate:22050,getChannelData:()=>new Float32Array([.2,.3])});expect(await pending).toBeNull();expect(a.decodedClips.size).toBe(0);
});
test('decoded cache remains bounded',async()=>{
 const {a,ctx}=setup();ctx.window.OfflineAudioContext=class{async decodeAudioData(){return {length:2,numberOfChannels:1,sampleRate:22050,getChannelData:()=>new Float32Array([.2,.3])}}};a.maxDecodedBytes=8;a.resolveAudioPath=async p=>p;for(const name of ['one','two']){a.audioSources.set('voice_default_en/'+name+'.mp3',{blob:new Blob(['mp3'])});await a.decodeVoiceClip(name+'.mp3')}expect(a.decodedClips.size).toBe(1);expect(a.decodedBytes).toBe(8);
});

test.each(['default','rachel','adam','antoni','matilda','de','es','fr'])('%s pack uses the same contiguous lap path',async voice=>{
 const {a,voice:select}=setup();select(voice);const primary=a.getPrimaryVoiceDirectory();for(const f of ['lap_1.mp3','num_3.mp3','point.mp3','num_44.mp3'])a.decodedClips.set(primary+'/'+f,{sampleRate:22050,samples:new Float32Array([.2,.3])});a.playPrerecorded=jest.fn();a.playWebSpeech=jest.fn();await a.speakComplexLapTime(1,3.44);expect(a.playPrerecorded).toHaveBeenCalledTimes(1);expect(a.playWebSpeech).not.toHaveBeenCalled();
});
test('playback failure cleans the WAV URL and falls back to one full utterance',async()=>{
 const {a,revoked}=setup();for(const f of ['lap_1.mp3','num_3.mp3','point.mp3','num_44.mp3'])a.decodedClips.set('voice_default_en/'+f,{sampleRate:22050,samples:new Float32Array([.2,.3])});a.playPrerecorded=jest.fn(async()=>{throw new Error('media failed')});a.playWebSpeech=jest.fn();await a.speakComplexLapTime(1,3.44);expect(revoked).toEqual(['blob:joined']);expect(a.playWebSpeech).toHaveBeenCalledWith('Lap 1, 3.44');
});
