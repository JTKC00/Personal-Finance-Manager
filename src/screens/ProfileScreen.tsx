import {Text} from 'react-native';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {colors} from '../theme';

export function ProfileScreen() {
  return (
    <Screen title="我的" subtitle="付款方式、分類管理、CSV 匯出與提醒設定">
      <Card title="資料與報表">
        <Text style={{color: colors.text, lineHeight: 20}}>
          MVP 會先提供本月 CSV 匯出、每日記帳次數、OCR 成功率與人工修正率。
        </Text>
      </Card>
    </Screen>
  );
}
