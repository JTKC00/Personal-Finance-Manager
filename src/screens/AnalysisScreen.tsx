import {Text} from 'react-native';
import {Card} from '../components/Card';
import {Screen} from '../components/Screen';
import {colors} from '../theme';

export function AnalysisScreen() {
  return (
    <Screen title="分析" subtitle="月份切換、收支總覽、分類分佈與 30 天趨勢">
      <Card title="分析頁骨架">
        <Text style={{color: colors.text, lineHeight: 20}}>
          將沿用 MVP 原型的資料聚合：總收入、總支出、儲蓄率、分類支出與趨勢圖。
        </Text>
      </Card>
    </Screen>
  );
}
