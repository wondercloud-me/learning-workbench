// Explicit developer refresh only. Runtime never crawls the site.
import {parse} from 'node-html-parser';
import {writeFile} from 'node:fs/promises';
const html=await (await fetch('https://www.runoob.com/',{signal:AbortSignal.timeout(20000)})).text();
const root=parse(html);
const descriptions=['从 Python 入门到数据处理与分析。','了解 AI 工具与应用开发。','制作网页界面与交互。','编写服务、接口与后端应用。','保存、查询和管理数据。','开发手机与跨平台应用。','运行、测试、部署与管理项目。','选择一门语言，从语法到程序。','理解算法、网络与计算机机制。','了解数据交换与 Web 服务。','学习 .NET 平台开发。','搭建并维护网站。'];
const categories=root.querySelectorAll('.codelist.codelist-desktop').map((el,i)=>({id:`category-${i+1}`,title:el.querySelector('h2')?.text.trim(),description:descriptions[i]||'',courses:el.querySelectorAll('a').filter(a=>a.querySelector('h4')).map(a=>({id:new URL(a.getAttribute('href'),'https://www.runoob.com').pathname,title:a.querySelector('h4').text.replace(/[【】]/g,'').replace(/^学习\s*/, '').trim(),description:a.querySelector('strong')?.text.trim()||'',url:new URL(a.getAttribute('href'),'https://www.runoob.com').href})).filter(c=>c.url.startsWith('https://www.runoob.com/'))})).filter(c=>c.title&&c.courses.length);
if(categories.length<10)throw new Error('目录结构已变化，拒绝替换快照');
await writeFile(new URL('../src/data/runoob-catalog.json',import.meta.url),JSON.stringify({source:'https://www.runoob.com/',updatedAt:new Date().toISOString(),categories},null,2)+'\n');
console.log(categories.length+' categories, '+categories.reduce((n,c)=>n+c.courses.length,0)+' courses');
