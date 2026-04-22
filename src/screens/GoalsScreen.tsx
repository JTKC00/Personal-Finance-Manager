import {Text} from 'react-native';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {colors} from '../theme';

export function GoalsScreen() {
  return (
    <Screen title="目標" subtitle="名稱、金額、目標日期與手動存入紀錄">
      <Card title="目標功能骨架">
        <Text style={{color: colors.text, lineHeight: 20}}>
          這裡會承接 HTML 原型的目標進度條、剩餘金額與手動存入紀錄。
        </Text>
      </Card>
    </Screen>
  );
}
