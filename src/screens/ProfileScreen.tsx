import {useCallback, useState} from 'react';
import {Alert, Linking, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {clearGeminiApiKey, loadGeminiApiKey, saveGeminiApiKey} from '../services/secrets';
import {colors, spacing} from '../theme';

const STEPS = [
  {
    num: '1',
    title: '打開 Google AI Studio',
    desc: '點下方按鈕，或在手機瀏覽器輸入 aistudio.google.com',
  },
  {
    num: '2',
    title: '登入 Google 帳號',
    desc: '用平時用的 Gmail 帳號登入即可，不需要信用卡。',
  },
  {
    num: '3',
    title: '點「Get API key」',
    desc: '在頁面左側邊欄或首頁找到「Get API key」按鈕，點進去。',
  },
  {
    num: '4',
    title: '建立新 Key',
    desc: '點「Create API key」，選擇任意 Google Cloud 專案（或讓系統自動建立一個），再點「Create」。',
  },
  {
    num: '5',
    title: '複製 Key',
    desc: '畫面會顯示一串以「AIza」開頭的金鑰，點「複製」圖示。',
  },
  {
    num: '6',
    title: '貼到下方輸入欄',
    desc: '回到這個 App，把剛才複製的 Key 貼到「Gemini API Key」欄位，按「儲存 Key」。',
  },
];

export function ProfileScreen() {
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  const refreshKeyState = useCallback(async () => {
    const key = await loadGeminiApiKey();
    setHasKey(Boolean(key));
    setKeyInput('');
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshKeyState();
    }, [refreshKeyState])
  );

  async function saveKey() {
    const key = keyInput.trim();
    if (!key) {
      Alert.alert('請輸入 Gemini API Key');
      return;
    }
    await saveGeminiApiKey(key);
    setHasKey(true);
    setKeyInput('');
    Alert.alert('已儲存', 'Gemini API Key 已安全儲存在本機裝置。');
  }

  async function clearKey() {
    await clearGeminiApiKey();
    setHasKey(false);
    setKeyInput('');
    Alert.alert('已清除', '本機 Gemini API Key 已清除。');
  }

  return (
    <Screen title="我的" subtitle="Gemini Key、資料報表與提醒設定">
      {/* ── Tutorial card ── */}
      <Card title="如何取得免費 Gemini API Key？">
        <Text style={styles.body}>
          OCR 功能使用 Google Gemini AI，需要一個免費的 API Key。申請只需 2 分鐘，完全免費，有免費使用額度。
        </Text>
        <Pressable
          onPress={() => setTutorialOpen(v => !v)}
          style={styles.tutorialToggle}
        >
          <Text style={styles.tutorialToggleText}>
            {tutorialOpen ? '▲ 收起教學' : '▼ 展開步驟教學'}
          </Text>
        </Pressable>
        {tutorialOpen && (
          <View style={styles.stepsContainer}>
            {STEPS.map(step => (
              <View key={step.num} style={styles.stepRow}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>{step.num}</Text>
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepDesc}>{step.desc}</Text>
                </View>
              </View>
            ))}
            <Pressable
              onPress={() => Linking.openURL('https://aistudio.google.com/apikey')}
              style={styles.linkButton}
            >
              <Text style={styles.linkButtonText}>🔗 前往 Google AI Studio 申請 Key</Text>
            </Pressable>
            <Text style={styles.freeNote}>
              ✅ 免費方案每天可使用 1,500 次 Gemini Flash 請求，個人日常記帳完全夠用。
            </Text>
          </View>
        )}
      </Card>

      {/* ── API Key input card ── */}
      <Card title="Gemini API Key">
        <Text style={styles.body}>
          取得 Key 後，貼到下方儲存。Key 只存在你的手機本機，不會上傳任何伺服器。
        </Text>
        <Text style={styles.status}>{hasKey ? '狀態：已設定本機 Key' : '狀態：尚未設定本機 Key'}</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setKeyInput}
          placeholder="貼上自己的 Gemini API Key"
          secureTextEntry
          style={styles.input}
          value={keyInput}
        />
        <View style={styles.actions}>
          <Pressable onPress={saveKey} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>儲存 Key</Text>
          </Pressable>
          <Pressable onPress={clearKey} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>清除 Key</Text>
          </Pressable>
        </View>
      </Card>

      <Card title="資料與報表">
        <Text style={styles.body}>MVP 會先提供本月 CSV 匯出、每日記帳次數、OCR 成功率與人工修正率。</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    color: colors.text,
    lineHeight: 20,
    marginBottom: spacing.md
  },
  status: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.md
  },
  input: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    marginBottom: spacing.md,
    padding: spacing.md
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: 8,
    flex: 1,
    padding: spacing.md
  },
  primaryButtonText: {
    color: colors.surface,
    fontWeight: '600'
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    padding: spacing.md
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: '600'
  },
  tutorialToggle: {
    alignSelf: 'flex-start',
    marginBottom: spacing.md
  },
  tutorialToggleText: {
    color: colors.warning,
    fontWeight: '600',
    fontSize: 14
  },
  stepsContainer: {
    gap: spacing.md
  },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start'
  },
  stepBadge: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24
  },
  stepBadgeText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: '700'
  },
  stepContent: {
    flex: 1
  },
  stepTitle: {
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2
  },
  stepDesc: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18
  },
  linkButton: {
    alignItems: 'center',
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    marginTop: spacing.sm,
    padding: spacing.md
  },
  linkButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14
  },
  freeNote: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm
  }
});
