'use strict';
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-category-fixture-')));

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({ width: 1000, height: 740, show: true, webPreferences: {
    preload: path.join(__dirname,'resource-manager-layout-preload.js'), contextIsolation:true, nodeIntegration:false, backgroundThrottling:false,
  } });
  window.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
  try {
    await window.loadFile(path.join(__dirname,'..','renderer','index.html'));
    for(let i=0;i<100;i++) {
      if(await window.webContents.executeJavaScript(`!document.getElementById('dash').hidden`))break;
      await new Promise(r=>setTimeout(r,30));
    }
    await window.webContents.executeJavaScript(`(async()=>{
      document.querySelector('.nav[data-page="browser"]').click(); document.getElementById('serviceTabPersonal').click();
      await new Promise(r=>setTimeout(r,100));
      window.campusCategoryStacks.render({
        resources:[1,2,3].map(id=>({id:'fixture-'+id,name:'Example Resource '+id,url:'https://example.invalid/'+id,favorite:true})),
        groups:[{id:'fixture-one',name:'学习资料',resourceIds:['fixture-1','fixture-2']},{id:'fixture-two',name:'常用网站',resourceIds:['fixture-3']}],
        translate:key=>({'workspace.more':'查看更多','resources.favorite':'收藏','resources.unfavorite':'取消收藏'}[key]||key),
        escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
      });
    })()`);
    await new Promise(r=>setTimeout(r,120));
    for(const width of [440,1000,1440,440,1000]) {
      window.setSize(width,740); await new Promise(r=>setTimeout(r,220));
      const layout=await window.webContents.executeJavaScript(`(()=>{
        const host=document.querySelector('#campusResources .cb-board-host');
        return {front:host.querySelectorAll('.cb-card.is-front').length,back:host.querySelectorAll('.cb-card.is-back').length,
          columns:host.style.getPropertyValue('--cb-columns')};
      })()`);
      assert.equal(layout.front,width>=980?2:1,'wide personal categories spread into two cards');
      assert.equal(layout.back,width>=980?0:1,'narrow categories return to one shared deck');
      assert.equal(Number(layout.columns),width>=980?2:1);
      const expected = await window.webContents.executeJavaScript(`(()=>{
        const card=document.querySelector('#campusResources .cb-card.is-front');
        const count=Number(card.querySelector('.cb-card-count').textContent);
        const expand=card.querySelector('[data-card-action="expand"]');
        if(!expand)throw new Error('small category has no expand control');
        expand.focus();expand.click();return count;
      })()`);
      await new Promise(r=>setTimeout(r,260));
      const result=await window.webContents.executeJavaScript(`(()=>{
        const dialog=document.querySelector('.cb-service-overlay');
        return {open:dialog?.open,count:dialog?.querySelectorAll('.cb-site').length,width:dialog?.getBoundingClientRect().width,
          cx:dialog?.getBoundingClientRect().x+dialog?.getBoundingClientRect().width/2,
          cy:dialog?.getBoundingClientRect().y+dialog?.getBoundingClientRect().height/2,vw:innerWidth,vh:innerHeight,
          overflow:document.documentElement.scrollWidth-innerWidth};
      })()`);
      assert.equal(result.open,true);assert.equal(result.count,expected);assert.ok(expected<=2);
      assert.ok(result.width<=width);assert.ok(result.overflow<=1);
      assert.ok(Math.abs(result.cx-result.vw/2)<2 && Math.abs(result.cy-result.vh/2)<2,'category detail is centered');
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
      await new Promise(r=>setTimeout(r,80));
      assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.cb-service-overlay').open`),false);
    }
    window.setSize(440,740); await new Promise(r=>setTimeout(r,220));
    const drawn = await window.webContents.executeJavaScript(`new Promise(resolve=>{
      const host=document.querySelector('#campusResources .cb-board-host');
      host.addEventListener('card-board-drawn',event=>resolve(event.detail),{once:true});
      host.querySelector('.cb-card.is-back [data-card-action="draw"]').click();
    })`);
    assert.ok(drawn.duration>=200 && drawn.duration<1000);
    const pageMotion=await window.webContents.executeJavaScript(`(()=>{
      const pager=document.getElementById('personalCategoryPager');
      pager.querySelector('button:not([aria-current])').click();
      return document.querySelector('#campusResources .cb-card.is-front').getAnimations().map(a=>a.effect.getTiming());
    })()`);
    assert.ok(pageMotion.some(t=>t.duration===240 && t.easing==='cubic-bezier(0.2, 0.8, 0.2, 1)'));
    await new Promise(r=>setTimeout(r,260));
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    const reduced=await window.webContents.executeJavaScript(`new Promise(resolve=>{
      const host=document.querySelector('#campusResources .cb-board-host');
      host.addEventListener('card-board-drawn',event=>resolve(event.detail),{once:true});
      host.querySelector('.cb-card.is-back [data-card-action="draw"]').click();
    })`);
    assert.ok(reduced.duration<100);
    process.stdout.write('personal category: PASS (small-list expansion, all rows, Escape, narrow/wide, deck and pager shared motion, reduced motion)\n');
  } finally { if(window.webContents.debugger.isAttached())window.webContents.debugger.detach();window.destroy(); }
}
main().then(()=>app.quit(),error=>{process.stderr.write(`${error.stack}\n`);app.exit(1);});
