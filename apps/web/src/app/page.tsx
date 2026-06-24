import { redirect } from 'next/navigation';

// A raiz redireciona para o cadastro de médicos (tela principal da Fase 1).
export default function Home() {
  redirect('/medicos');
}
