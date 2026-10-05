import { authenticated } from '@/lib/auth';
import { CrmApp } from '@/components/crm-app';
import { Login } from '@/components/login';
export default async function Page() { return await authenticated() ? <CrmApp/> : <Login/>; }
