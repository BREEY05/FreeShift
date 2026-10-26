import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { ImportResult } from '@freeshift/shared';
import { boardExportUrl, importSchedulesCsv, schedulesExportUrl } from '../../../api/export';
import { getErrorMessage } from '../../../lib/errors';
import { Alert } from '../../ui/Alert';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Dialog } from '../../ui/Dialog';
import { Select } from '../../ui/Input';

const CSV_EXAMPLE =
  'user,weekday,slot_label,start_week,end_week,parity,note\n' +
  '小林,1,第1-2节,1,16,all,高数\n' +
  '阿青,3,第3-4节,1,8,odd,实验';

export interface DataTransferPanelProps {
  totalWeeks: number;
  currentWeek: number;
  onSaved: (message: string) => void;
}

interface SelectedFile {
  name: string;
  text: string;
  rowCount: number;
}

function countRows(text: string): number {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
}

function weekOptions(totalWeeks: number): number[] {
  return Array.from({ length: Math.max(totalWeeks, 1) }, (_, index) => index + 1);
}

function ExportLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      download
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors duration-150 hover:bg-canvas"
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      {children}
    </a>
  );
}

function ImportResultView({ result, tone }: { result: ImportResult; tone: 'preview' | 'done' }) {
  return (
    <div className="space-y-2 rounded-control border border-line bg-canvas px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-ink">
        {tone === 'preview' ? <Upload className="h-3.5 w-3.5 text-brand" aria-hidden /> : <FileUp className="h-3.5 w-3.5 text-mint" aria-hidden />}
        {tone === 'preview' ? '预览结果（未写入数据库）' : '导入结果'}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="mint">{tone === 'preview' ? '将会新建' : '已新建'} {result.created} 条</Badge>
        <Badge tone="amber">跳过 {result.skipped} 条</Badge>
        <Badge tone={result.errors.length > 0 ? 'danger' : 'neutral'}>错误 {result.errors.length} 条</Badge>
      </div>
      {result.errors.length > 0 ? (
        <ul className="scrollbar-thin max-h-40 space-y-1 overflow-y-auto pr-1">
          {result.errors.map((error) => (
            <li key={error.row + '-' + error.message} className="flex flex-wrap items-baseline gap-x-2 text-2xs">
              <span className="tabular shrink-0 font-medium text-danger">第 {error.row} 行</span>
              <span className="text-muted">{error.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-2xs text-subtle">没有解析错误。</p>
      )}
      <p className="text-2xs leading-4 text-subtle">
        跳过表示该行与已有占用冲突或与本次导入的其它行重复；可修正 CSV 后重试。
      </p>
    </div>
  );
}

/** 数据导入导出：CSV 下载 + dry_run 预览后正式导入 */
export function DataTransferPanel({ totalWeeks, currentWeek, onSaved }: DataTransferPanelProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const weeks = weekOptions(totalWeeks);

  const [exportFrom, setExportFrom] = useState(1);
  const [exportTo, setExportTo] = useState(totalWeeks);
  const [boardWeek, setBoardWeek] = useState(currentWeek);
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setExportFrom(1);
    setExportTo(totalWeeks);
    setBoardWeek((prev) => (prev <= totalWeeks ? prev : totalWeeks));
  }, [totalWeeks]);

  useEffect(() => {
    setBoardWeek((prev) => (prev >= 1 ? prev : currentWeek));
  }, [currentWeek]);

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('请先选择 CSV 文件');
      return importSchedulesCsv(file.text, true);
    },
    onSuccess: (result) => {
      setPreview(result);
      setImported(null);
    },
  });

  const importMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('请先选择 CSV 文件');
      return importSchedulesCsv(file.text, false);
    },
    onSuccess: async (result) => {
      setPreview(null);
      setImported(result);
      setConfirmOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['board'] }),
        queryClient.invalidateQueries({ queryKey: ['schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['stats'] }),
        queryClient.invalidateQueries({ queryKey: ['recommend'] }),
      ]);
      onSaved('CSV 导入完成：新建 ' + result.created + ' 条，跳过 ' + result.skipped + ' 条');
    },
  });

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFileError(null);
    setPreview(null);
    setImported(null);
    previewMutation.reset();
    importMutation.reset();
    try {
      const text = await selected.text();
      setFile({ name: selected.name, text, rowCount: countRows(text) });
    } catch {
      setFile(null);
      setFileError('读取文件失败，请重试或改用 UTF-8 编码的 CSV 文件。');
    }
  }

  function clearFile() {
    setFile(null);
    setPreview(null);
    setImported(null);
    setFileError(null);
    previewMutation.reset();
    importMutation.reset();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const importError = previewMutation.isError
    ? getErrorMessage(previewMutation.error)
    : importMutation.isError
      ? getErrorMessage(importMutation.error)
      : null;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-xs font-semibold text-ink">数据导入导出</h2>
        <p className="mt-0.5 text-2xs text-muted">CSV 可直接用 Excel 打开；导入会按成员姓名与当前模板的时间段名称匹配。</p>
      </div>

      <div className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-2">
        <div className="rounded-control border border-line px-3 py-2.5">
          <div className="text-xs font-medium text-ink">导出安排 CSV</div>
          <p className="mt-0.5 text-2xs text-muted">列：user,weekday,slot_label,start_week,end_week,parity,note</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-2xs text-muted">第</span>
            <div className="w-20">
              <Select aria-label="导出自周" value={String(exportFrom)} onChange={(event) => setExportFrom(Number(event.target.value))} className="h-8 text-xs">
                {weeks.map((week) => (
                  <option key={week} value={week}>
                    {week}
                  </option>
                ))}
              </Select>
            </div>
            <span className="text-2xs text-muted">–</span>
            <div className="w-20">
              <Select aria-label="导出至周" value={String(exportTo)} onChange={(event) => setExportTo(Number(event.target.value))} className="h-8 text-xs">
                {weeks.map((week) => (
                  <option key={week} value={week}>
                    {week}
                  </option>
                ))}
              </Select>
            </div>
            <span className="text-2xs text-muted">周</span>
            <ExportLink href={schedulesExportUrl(Math.min(exportFrom, exportTo), Math.max(exportFrom, exportTo))}>
              下载安排 CSV
            </ExportLink>
          </div>
        </div>

        <div className="rounded-control border border-line px-3 py-2.5">
          <div className="text-xs font-medium text-ink">导出当前周看板 CSV</div>
          <p className="mt-0.5 text-2xs text-muted">首列时间段，周一至周日，格子内容「空闲 N/M」</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-2xs text-muted">周次</span>
            <div className="w-24">
              <Select aria-label="看板导出周次" value={String(boardWeek)} onChange={(event) => setBoardWeek(Number(event.target.value))} className="h-8 text-xs">
                {weeks.map((week) => (
                  <option key={week} value={week}>
                    第 {week} 周
                  </option>
                ))}
              </Select>
            </div>
            <ExportLink href={boardExportUrl(boardWeek)}>下载看板 CSV</ExportLink>
          </div>
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="text-xs font-medium text-ink">导入安排 CSV</div>
        <p className="mt-0.5 text-2xs text-muted">
          先预览（dry_run）确认结果，再正式写入。表头需包含 user, weekday, slot_label, start_week, end_week, parity；note 可选。
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="选择 CSV 文件"
          onChange={(event) => void handleFileChange(event)}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" iconLeft={<Upload className="h-3.5 w-3.5" aria-hidden />} onClick={() => fileInputRef.current?.click()}>
            选择 CSV 文件
          </Button>
          {file ? (
            <>
              <Badge tone="neutral">
                {file.name} · {file.rowCount} 行
              </Badge>
              <Button variant="ghost" size="sm" onClick={clearFile}>
                移除
              </Button>
            </>
          ) : (
            <span className="text-2xs text-subtle">未选择文件</span>
          )}
          <Button
            variant="soft"
            size="sm"
            loading={previewMutation.isPending}
            disabled={!file || importMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            预览导入（dry_run）
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!file || preview === null || importMutation.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            正式导入
          </Button>
        </div>

        {fileError ? (
          <Alert tone="danger" className="mt-2">
            {fileError}
          </Alert>
        ) : null}
        {importError ? (
          <Alert tone="danger" title="导入未完成" className="mt-2">
            {importError}
          </Alert>
        ) : null}
        {preview ? (
          <div className="mt-2">
            <ImportResultView result={preview} tone="preview" />
          </div>
        ) : null}
        {imported ? (
          <div className="mt-2">
            <ImportResultView result={imported} tone="done" />
          </div>
        ) : null}

        <details className="mt-3 rounded-control border border-line bg-canvas px-3 py-2">
          <summary className="cursor-pointer text-2xs font-medium text-muted">CSV 列格式说明</summary>
          <div className="mt-2 space-y-2 text-2xs leading-5 text-muted">
            <ul className="list-disc space-y-0.5 pl-4">
              <li>编码 UTF-8；第一行为表头，逗号分隔，支持双引号包裹含逗号的内容。</li>
              <li>user：成员姓名，需与用户列表中的名称完全一致。</li>
              <li>weekday：1–7（周一 = 1，周日 = 7）。</li>
              <li>slot_label：时间段名称，需与当前启用模板中的名称一致。</li>
              <li>start_week / end_week：1–学期总周次，且起始不大于结束。</li>
              <li>parity：all / odd / even，留空按 all 处理。</li>
              <li>note：备注，可留空；无法解析的行计入错误但不中断整批导入。</li>
            </ul>
            <pre className="scrollbar-thin overflow-x-auto rounded-control border border-line bg-surface p-2 text-2xs leading-5 text-ink">
              {CSV_EXAMPLE}
            </pre>
          </div>
        </details>
      </div>

      {confirmOpen && preview ? (
        <Dialog
          open
          onClose={() => {
            if (!importMutation.isPending) setConfirmOpen(false);
          }}
          size="sm"
          title="确认正式导入"
          footer={
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={importMutation.isPending}>
                取消
              </Button>
              <Button variant="primary" loading={importMutation.isPending} onClick={() => importMutation.mutate()}>
                确认导入
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Alert tone="warning" title="将写入数据库">
              预计新建 {preview.created} 条安排、跳过 {preview.skipped} 条；{preview.errors.length} 行存在解析错误会被忽略。
            </Alert>
            <p className="text-xs leading-5 text-muted">
              导入后看板、统计与推荐数据会立即刷新。若结果不符合预期，可在看板中删除对应安排后重新导入。
            </p>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}
