import React from 'react';
import { Switch } from 'antd';
import { SunOutlined, MoonOutlined } from '@ant-design/icons';

interface ThemeSelectorProps {
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

export default function ThemeSelector({ isDarkMode, setIsDarkMode }: ThemeSelectorProps) {
  return (
    <Switch
      checked={isDarkMode}
      onChange={setIsDarkMode}
      checkedChildren={<MoonOutlined />}
      unCheckedChildren={<SunOutlined />}
      style={{ marginLeft: 16 }}
    />
  );
}
