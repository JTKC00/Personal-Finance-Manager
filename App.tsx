import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {StatusBar} from 'expo-status-bar';
import {ActivityIndicator, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {DashboardScreen} from './src/screens/DashboardScreen';
import {AnalysisScreen} from './src/screens/AnalysisScreen';
import {TransactionScreen} from './src/screens/TransactionScreen';
import {GoalsScreen} from './src/screens/GoalsScreen';
import {ProfileScreen} from './src/screens/ProfileScreen';
import {LoginScreen} from './src/screens/LoginScreen';
import {AuthProvider, useAuth} from './src/contexts/AuthContext';
import {colors} from './src/theme';

export type RootTabParamList = {
  Dashboard: undefined;
  Analysis: undefined;
  Transaction: undefined;
  Goals: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const icons: Record<keyof RootTabParamList, keyof typeof Ionicons.glyphMap> = {
  Dashboard: 'home-outline',
  Analysis: 'bar-chart-outline',
  Transaction: 'add-circle-outline',
  Goals: 'flag-outline',
  Profile: 'person-outline'
};

function AppNavigator() {
  const {user, loading} = useAuth();

  if (loading) {
    return (
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background}}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <Tab.Navigator
        screenOptions={({route}) => ({
          headerShown: false,
          tabBarActiveTintColor: '#1a1a18',
          tabBarInactiveTintColor: '#888780',
          tabBarStyle: {height: 64, paddingBottom: 8, paddingTop: 6},
          tabBarIcon: ({color, size}) => (
            <Ionicons name={icons[route.name]} size={size} color={color} />
          )
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} options={{title: '首頁'}} />
        <Tab.Screen name="Analysis" component={AnalysisScreen} options={{title: '分析'}} />
        <Tab.Screen name="Transaction" component={TransactionScreen} options={{title: '記帳'}} />
        <Tab.Screen name="Goals" component={GoalsScreen} options={{title: '目標'}} />
        <Tab.Screen name="Profile" component={ProfileScreen} options={{title: '我的'}} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppNavigator />
    </AuthProvider>
  );
}

