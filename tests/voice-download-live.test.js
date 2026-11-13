const fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(path.join(__dirname,'../data/script.js'),'utf8');
function extract(name){let at=source.indexOf('function '+name+'('),depth=0;const start=source.slice(at-6,at)==='async '?at-6:at;for(let i=source.indexOf('{',at);i<source.length;i++){if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)return source.slice(start,i+1)}}
test('voice download pauses this page live traffic and restores it exactly once',()=>{
 const close=jest.fn(),setup=jest.fn(),ctx={window:{},eventSource:{close},eventSourceReconnectTimer:12,connectionStatusUpdateInterval:34,clearTimeout:jest.fn(),clearInterval:jest.fn(),setupWiFiEvents:setup};vm.createContext(ctx);vm.runInContext(extract('pauseLiveForVoiceDownload'),ctx);const resume=ctx.pauseLiveForVoiceDownload();expect(close).toHaveBeenCalledTimes(1);expect(ctx.clearTimeout).toHaveBeenCalledWith(12);expect(ctx.clearInterval).toHaveBeenCalledWith(34);expect(ctx.window.voicePackTransferPaused).toBe(true);resume();resume();expect(ctx.window.voicePackTransferPaused).toBe(false);expect(setup).toHaveBeenCalledTimes(1);
});
test('local start cannot race a pending explicit voice download',async()=>{
 const ctx={audioAnnouncer:{packDownloadActive:true},i18n:{t:key=>key},alert:jest.fn(),fetch:jest.fn()};vm.createContext(ctx);vm.runInContext(extract('startRace'),ctx);await ctx.startRace();expect(ctx.alert).toHaveBeenCalled();expect(ctx.fetch).not.toHaveBeenCalled();
});
