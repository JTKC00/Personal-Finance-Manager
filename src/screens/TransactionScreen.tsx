import {useMemo, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {expenseCategories, paymentMethods} from '../constants/categories';
import {scanReceipt} from '../services/ocr';
import {trackEvent, upsertReceipt, upsertTransaction} from '../services/storage';
import {colors, spacing} from '../theme';
import {OcrResult, Transaction} from '../types/finance';

type Draft = {
  amount: string;
  category: string;
  note: string;
  date: string;
  paymentMethod: string;
};

const today = () => new Date().toISOString().slice(0, 10);

export function TransactionScreen() {
  const [draft, setDraft] = useState<Draft>({
    amount: '',
    category: expenseCategories[0],
    note: '',
    date: today(),
    paymentMethod: paymentMethods[0]
  });
  const [scanning, setScanning] = useState(false);
  const [ocrPreview, setOcrPreview] = useState<OcrResult | null>(null);

  const canSave = useMemo(() => Number(draft.amount) > 0 && Boolean(draft.date), [draft.amount, draft.date]);

  function updateDraft(patch: Partial<Draft>) {
    setDraft(current => ({...current, ...patch}));
  }

  async function save() {
    const value = Number(draft.amount);
    if (!value || !draft.date) {
      Alert.alert('請確認交易內容', '金額與日期為必填。');
      return;
    }

    const transaction: Transaction = {
      id: Date.now().toString(),
      type: 'expense',
      amount: value,
      currency: 'HKD',
      date: draft.date,
      category: draft.category,
      paymentMethod: draft.paymentMethod,
      note: draft.note,
      createdAt: new Date().toISOString()
    };

    await upsertTransaction(transaction);
    await trackEvent('save_transaction_success', {source: ocrPreview ? 'ocr' : 'manual', category: draft.category});
    setDraft({
      amount: '',
      category: expenseCategories[0],
      note: '',
      date: today(),
      paymentMethod: paymentMethods[0]
    });
    setOcrPreview(null);
    Alert.alert('已儲存', '交易已加入本機資料。');
  }

  async function requestAndPick(source: 'camera' | 'library') {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('需要權限', source === 'camera' ? '請允許相機權限以拍攝收據。' : '請允許相簿權限以選取收據。');
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({base64: true, quality: 0.85})
      : await ImagePicker.launchImageLibraryAsync({base64: true, mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85});

    if (result.canceled || !result.assets[0]?.base64) return;
    await runOcr(result.assets[0]);
  }

  async function runOcr(asset: ImagePicker.ImagePickerAsset) {
    if (!asset.base64) {
      Alert.alert('圖片讀取失敗', '沒有取得圖片 base64，請重新選取。');
      return;
    }
    const imageBase64 = asset.base64;
    const id = Date.now().toString();
    setScanning(true);
    await trackEvent('ocr_scan_start', {mimeType: asset.mimeType || 'image/jpeg'});
    await upsertReceipt({
      id,
      imageBase64,
      imageUri: asset.uri,
      status: 'processing',
      createdAt: new Date().toISOString()
    });

    try {
      const result = await scanReceipt(imageBase64, asset.mimeType || 'image/jpeg');
      const lowFields = [
        !result.amount ? 'amount' : '',
        !expenseCategories.includes(result.category) ? 'category' : '',
        !/^\d{4}-\d{2}-\d{2}$/.test(result.date) ? 'date' : ''
      ].filter(Boolean);

      updateDraft({
        amount: result.amount ? String(result.amount) : '',
        category: expenseCategories.includes(result.category) ? result.category : '其他',
        note: result.note || '',
        date: /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : today()
      });
      setOcrPreview(result);
      await upsertReceipt({
        id,
        imageBase64,
        imageUri: asset.uri,
        status: 'done',
        amount: result.amount,
        category: result.category,
        note: result.note,
        date: result.date,
        lowFields,
        needsConfirm: true,
        createdAt: new Date().toISOString()
      });
      await trackEvent(lowFields.length ? 'ocr_scan_fail' : 'ocr_scan_success', {lowFields});
    } catch (error) {
      await upsertReceipt({
        id,
        imageBase64,
        imageUri: asset.uri,
        status: 'failed',
        lowFields: ['amount', 'category', 'date'],
        needsConfirm: true,
        createdAt: new Date().toISOString()
      });
      await trackEvent('ocr_scan_fail', {reason: error instanceof Error ? error.message : 'unknown'});
      Alert.alert('OCR 失敗', '已保留手動輸入流程，請確認 proxy 與 GEMINI_API_KEY。');
    } finally {
      setScanning(false);
    }
  }

  return (
    <Screen title="記帳" subtitle="快速新增、拍照 OCR、相簿 OCR">
      <Card title="收據 OCR">
        <View style={styles.actionRow}>
          <Pressable disabled={scanning} onPress={() => requestAndPick('camera')} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>拍照掃描</Text>
          </Pressable>
          <Pressable disabled={scanning} onPress={() => requestAndPick('library')} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>相簿選取</Text>
          </Pressable>
        </View>
        {scanning ? <ActivityIndicator color={colors.text} style={styles.spinner} /> : null}
        {ocrPreview ? <Text style={styles.hint}>已預填 OCR 結果，請確認後儲存。</Text> : null}
      </Card>

      <Card title="快速新增">
        <TextInput
          autoFocus
          keyboardType="numeric"
          onChangeText={amount => updateDraft({amount})}
          placeholder="金額"
          style={styles.input}
          value={draft.amount}
        />
        <TextInput
          onChangeText={note => updateDraft({note})}
          placeholder="備註或商戶"
          style={styles.input}
          value={draft.note}
        />
        <TextInput
          onChangeText={date => updateDraft({date})}
          placeholder="YYYY-MM-DD"
          style={styles.input}
          value={draft.date}
        />
        <View style={styles.chips}>
          {expenseCategories.map(item => (
            <Pressable key={item} onPress={() => updateDraft({category: item})} style={[styles.chip, item === draft.category && styles.activeChip]}>
              <Text style={styles.chipText}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.chips}>
          {paymentMethods.map(item => (
            <Pressable key={item} onPress={() => updateDraft({paymentMethod: item})} style={[styles.chip, item === draft.paymentMethod && styles.activeChip]}>
              <Text style={styles.chipText}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable disabled={!canSave} onPress={save} style={[styles.button, !canSave && styles.disabledButton]}>
          <Text style={styles.buttonText}>新增</Text>
        </Pressable>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    fontSize: 18,
    marginBottom: spacing.md,
    padding: spacing.md
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  chip: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  activeChip: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.text
  },
  chipText: {
    color: colors.text
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: 8,
    padding: spacing.md
  },
  disabledButton: {
    opacity: 0.4
  },
  buttonText: {
    color: colors.surface,
    fontWeight: '600'
  },
  secondaryButton: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    padding: spacing.md
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '600',
    textAlign: 'center'
  },
  spinner: {
    marginTop: spacing.md
  },
  hint: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.md
  }
});
