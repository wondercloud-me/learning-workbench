import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {CourseHome,MaterialContent} from '../src/renderer/course-home';
import {emptyState} from '../src/core/state';
import {openTab,closeTab,reopenTab,emptyTabs} from '../src/core/tabs';
it('home starts with guided categories and existing learning, never asks for an AI plan',()=>{
 const html=renderToStaticMarkup(<CourseHome state={emptyState()} busy={false} onOpenLesson={async()=>{}} onResume={()=>{}}/>);
 expect(html).toContain('后端开发');expect(html).toContain('选择一个方向');expect(html).toContain('搜索课程');expect(html).not.toContain('AI 起草');expect(html).not.toContain('Python3 循环');
});
it('renders safe source text, code and tables; images require action',()=>{
 const html=renderToStaticMarkup(<MaterialContent blocks={[{kind:'code',text:'<script>steal()</script>\n  x'},{kind:'table',rows:[['名称','作用']]},{kind:'image',url:'https://www.runoob.com/a.png',alt:'配图'}]}/>);
 expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).toContain('加载配图');expect(html).toContain('<table');
});
it('source tabs close and restore independently without discarding chapter state',()=>{
 const tab={id:'lesson:c',kind:'lesson' as const,title:'教材',resource:'c'};const opened=openTab(emptyTabs(),tab);expect(reopenTab(closeTab(opened,tab.id)).tabs).toEqual([tab]);
});
