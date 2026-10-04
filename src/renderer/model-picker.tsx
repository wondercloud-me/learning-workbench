import React from 'react';
import type { ModelLibrary, ModelSelection } from '../core/model-library';
import { Icon } from './shell';
import './model-picker.css';

export function ModelPicker({ library, keyStatus, disabled, onSelect, onManage }: {
  library: ModelLibrary; keyStatus: Record<string, boolean>; disabled: boolean;
  onSelect: (selection: ModelSelection) => void; onManage: () => void;
}) {
  const value = library.active ? JSON.stringify(library.active) : '';
  const ready = library.active && keyStatus[library.active.profileId];
  return <div className="model-picker">
    <Icon name="hubot"/>
    <select aria-label="选择聊天模型" title="用于接下来的主聊天、辅助对话和项目 Agent；已有对话保留" value={value} disabled={disabled || !library.profiles.length} onChange={event => {
      const option = library.profiles.flatMap(profile => profile.models.map(model => ({ profileId: profile.id, model }))).find(selection => JSON.stringify(selection) === event.target.value);
      if (option) onSelect(option);
    }}>
      {!library.active && <option value="">先添加 API 配置</option>}
      {library.profiles.map(profile => <optgroup key={profile.id} label={profile.name}>{profile.models.map(model => <option key={model} value={JSON.stringify({ profileId: profile.id, model })}>{profile.name} / {model}</option>)}</optgroup>)}
    </select>
    <span className={`model-key-indicator ${ready ? 'ready' : ''}`} title={ready ? '当前接口的 Key 已在本次运行中启用' : '到模型设置填写此接口的 API Key'}>{ready ? '已就绪' : '待配置'}</span>
    <button type="button" disabled={disabled} onClick={onManage} title="管理 API 和模型"><Icon name="settings-gear"/>管理</button>
  </div>;
}
