import {useCallback, useState} from 'react';
import {Alert, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {clearGeminiApiKey, loadGeminiApiKey, saveGeminiApiKey} from '../services/secrets';
import {colors, spacing} from '../theme';

export function ProfileScreen() {
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);

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
      <Card title="Gemini API Key">
        <Text style={styles.body}>
          混合模式：你可以使用自己的 Gemini API Key；若留空，OCR proxy 會嘗試使用 server fallback。
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
  }
});
