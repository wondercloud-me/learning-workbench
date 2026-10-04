export interface Course { id: string; title: string; description: string; url: string }
export interface CatalogCategory { id: string; title: string; description: string; courses: Course[] }
export interface CourseDirectory { url: string; title: string; chapters: Array<{title: string; url: string}> }
export type MaterialBlock = {kind:'paragraph';text:string} | {kind:'code';text:string} | {kind:'table';rows:string[][]} | {kind:'image';url:string;alt:string} | {kind:'link';url:string;title:string};
export interface LessonSection {id:string;title:string;blocks:MaterialBlock[]}
export interface LessonDocument {url:string;title:string;version:string;fetchedAt:string;sections:LessonSection[]}
export interface LessonSource {course:Course;url:string;version:string;sectionIds:string[]}
export interface TutorialStats {bytes:number;budget:number;entries:number;pinned:number}
