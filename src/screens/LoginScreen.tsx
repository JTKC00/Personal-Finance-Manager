import {useState} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
} from 'react-native';
import {useAuth} from '../contexts/AuthContext';
import {colors, spacing} from '../theme';

export function LoginScreen() {
  const {signIn, signUp} = useAuth();
  const [tab, setTab] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('請填寫電郵和密碼');
      return;
    }
    setLoading(true);
    try {
      if (tab === 'signIn') {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('登入失敗', translateFirebaseError(msg));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>個人財務管家</Text>
        <Text style={styles.subtitle}>
          登入後，記帳數據自動備份至雲端{'\n'}換手機不再怕資料消失
        </Text>

        <View style={styles.tabs}>
          <Pressable
            onPress={() => setTab('signIn')}
            style={[styles.tab, tab === 'signIn' && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === 'signIn' && styles.tabTextActive]}>
              登入
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab('signUp')}
            style={[styles.tab, tab === 'signUp' && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === 'signUp' && styles.tabTextActive]}>
              建立帳號
            </Text>
          </Pressable>
        </View>

        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="電郵地址"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={email}
        />
        <TextInput
          autoCapitalize="none"
          onChangeText={setPassword}
          placeholder="密碼（最少 6 位）"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          style={styles.input}
          value={password}
        />

        <Pressable disabled={loading} onPress={submit} style={styles.button}>
          {loading ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.buttonText}>
              {tab === 'signIn' ? '登入' : '建立帳號'}
            </Text>
          )}
        </Pressable>

        <Text style={styles.note}>
          你的記帳數據屬於你自己，{'\n'}不會與其他人共享。
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

function translateFirebaseError(msg: string): string {
  if (
    msg.includes('user-not-found') ||
    msg.includes('wrong-password') ||
    msg.includes('invalid-credential')
  ) {
    return '電郵或密碼不正確，請再試。';
  }
  if (msg.includes('email-already-in-use')) return '此電郵已被使用，請直接登入。';
  if (msg.includes('weak-password')) return '密碼太弱，請使用至少 6 個字元。';
  if (msg.includes('invalid-email')) return '電郵格式不正確。';
  if (msg.includes('network-request-failed')) return '網絡連線失敗，請檢查網絡。';
  return msg;
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl * 2,
    gap: spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    padding: 4,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 6,
    alignItems: 'center',
  },
  tabActive: {backgroundColor: colors.surface},
  tabText: {fontSize: 14, color: colors.textMuted},
  tabTextActive: {color: colors.text, fontWeight: '600'},
  input: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  button: {
    backgroundColor: colors.text,
    borderRadius: 8,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: {color: colors.surface, fontWeight: '600', fontSize: 16},
  note: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 20,
  },
});
