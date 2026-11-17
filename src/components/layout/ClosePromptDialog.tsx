/**
 * 首次关窗询问弹窗
 *
 * 只在 `prefs.closeAction === 'ask'` 时出现一次；用户选完即记住（写入 prefs）。
 * 关窗处理器在等这个弹窗的答案（`useClosePromptStore.request()` 返回的 Promise），
 * 所以这里必须**总能给出一个答案**：点遮罩、按 Esc 都等价于「取消这次关窗」。
 */

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useClosePromptStore } from '@/stores/closePrompt';

/** 关窗询问弹窗 */
export function ClosePromptDialog(): ReactNode {
  const { t } = useTranslation();
  const open = useClosePromptStore((state) => state.open);
  const answer = useClosePromptStore((state) => state.answer);

  return (
    <Dialog
      open={open}
      maxWidth="xs"
      fullWidth
      // 遮罩点击 / Esc 视同「取消这次关窗」——不能留下一个永远等不到答案的 Promise
      onClose={() => answer('cancel')}
    >
      <DialogTitle>{t('closePrompt.title')}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t('closePrompt.body')}</DialogContentText>
        <p className="mt-3 text-xs text-dim">{t('closePrompt.hint')}</p>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => answer('cancel')}>{t('common.cancel')}</Button>
        <Button onClick={() => answer('quit')}>{t('closePrompt.quit')}</Button>
        <Button variant="contained" onClick={() => answer('tray')}>
          {t('closePrompt.toTray')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
