// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { config as aceConfig } from 'ace-builds';
import 'ace-builds/src-min-noconflict/ace';
import 'ace-builds/src-min-noconflict/mode-json';
import 'ace-builds/src-min-noconflict/theme-dracula';
import type { HTMLAttributes } from 'react';
import AceEditor from 'react-ace';
// The syntax-check worker script is not bundled; without this default the
// editor keeps a worker request open forever. Saving validates the JSON.
aceConfig.setDefaultValue('session', 'useWorker', false);

interface JSONEditorProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  value: string;
  onUpdate: (value: string) => void;
}

const JSONEditor = ({ name, value, onUpdate, onBlur }: JSONEditorProps) => {
  return (
    <div className="w-full overflow-hidden rounded-ctl border border-line">
      <AceEditor
        mode="json"
        theme="dracula"
        onChange={onUpdate}
        name={name}
        editorProps={{ $blockScrolling: true }}
        // No syntax worker: its script is not bundled, and the page validates
        // the JSON itself when saving.
        setOptions={{ useWorker: false }}
        value={value}
        onBlur={onBlur}
        height="300px"
        width="100%"
      />
    </div>
  );
};

export default JSONEditor;
