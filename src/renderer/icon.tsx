import React from 'react';
import '@vscode/codicons/dist/codicon.css';

export function Icon({name}: {name: string}) {
  return <i aria-hidden="true" className={`codicon codicon-${name}`}/>;
}
