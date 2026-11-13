const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'../data/index.html'),'utf8');
const source=html.match(/<script>\s*\/\/ Download dependencies[\s\S]*?<\/script>/)[0].replace(/^<script>/,'').replace(/<\/script>$/,'');
function setup(alwaysFail=false){
 const calls=[],executed=[],nodes=new Map();let active=0,maxActive=0,ctx;
 const head={appendChild(node){if(node.tag==='script'){executed.push(node.textContent);vm.runInContext(node.textContent,ctx)}}};
 const document={head,body:{appendChild(node){nodes.set(node.id,node)}},getElementById:id=>nodes.get(id),createElement:tag=>({tag,style:{},setAttribute(){},appendChild(node){this.child=node},remove(){this.removed=true}})};
 const sandbox={document,console:{error:jest.fn()},AbortController,setTimeout:fn=>{Promise.resolve().then(fn);return 1},clearTimeout(){},location:{origin:'http://gate',reload:jest.fn()},addEventListener(){},removeEventListener(){},ready:[]};sandbox.window=sandbox;
 sandbox.fetch=jest.fn(async file=>{active++;maxActive=Math.max(maxActive,active);calls.push(file);await Promise.resolve();active--;if(file==='smoothie.js'&&(alwaysFail||calls.filter(x=>x===file).length===1))return {ok:false,status:503,body:{cancel:async()=>{}}};return {ok:true,text:async()=>file.endsWith('.css')?'':`window.whenFPVGateReady(()=>window.ready.push('${file}'));`}});
 ctx=vm.createContext(sandbox);vm.runInContext(source,ctx);return {sandbox,calls,executed,nodes,max:()=>maxActive};
}
async function settle(condition){for(let i=0;i<300;i++){if(condition())return;await Promise.resolve()}throw new Error('startup did not settle')}
test('busy dependency is retried, downloads are sequential, app starts only after all scripts arrive',async()=>{
 const r=setup();await settle(()=>r.sandbox.ready.length===13);expect(r.max()).toBe(1);expect(r.calls.filter(x=>x==='smoothie.js')).toHaveLength(2);expect(r.sandbox.ready[0]).toBe('jquery-3.7.1.min.js');expect(r.sandbox.ready.indexOf('smoothie.js')).toBeLessThan(r.sandbox.ready.indexOf('script.js'));expect(r.sandbox.fpvGateLoading).toBe(false);expect(r.nodes.get('appLoadStatus').removed).toBe(true);
});
test('permanent dependency failure offers retry without running a partial app',async()=>{
 const r=setup(true);await settle(()=>r.nodes.get('appLoadStatus')?.child);expect(r.calls.filter(x=>x==='smoothie.js')).toHaveLength(4);expect(r.executed).toHaveLength(0);expect(r.nodes.get('appLoadStatus').textContent).toContain('Could not load smoothie.js');expect(r.nodes.get('appLoadStatus').child.textContent).toBe('Retry loading');
});
