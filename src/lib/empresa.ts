// Dados da empresa emissora (cabeçalho/rodapé de propostas, contratos, OS, pedidos).
// FALLBACK: usado só quando a empresa ativa ainda não tem os dados preenchidos.
// Os dados reais vêm da empresa ativa via useEmissora() (src/lib/useEmissora.ts).
export const EMISSORA = {
  nome: "MSFORT SERVIÇOS",
  cnpj: "57.802.375/0001-92",
  endereco: "Rua Julia Sales, 2020, Salinas, Fortaleza-CE",
  telefone: "85 98219-2854",
  logo: "/fotos-proposta/logo.png",
  sistema: "SISTEMA NOVALUZ",
};
export type Emissora = typeof EMISSORA;

// Fotos disponíveis para o portfólio / itens (arquivos em public/fotos-proposta).
export const FOTOS_PORTFOLIO = [
  { arquivo: "/fotos-proposta/Mao_de_obra_qualificada.jpeg", titulo: "Mão de obra qualificada" },
  { arquivo: "/fotos-proposta/Mezaninos.jpeg", titulo: "Mezaninos" },
  { arquivo: "/fotos-proposta/Solda-Andaime.jpeg", titulo: "Solda em andaime" },
  { arquivo: "/fotos-proposta/Solda-case-escora.jpeg", titulo: "Case escora" },
  { arquivo: "/fotos-proposta/Solda-escora.jpeg", titulo: "Solda de escora" },
  { arquivo: "/fotos-proposta/Solda-especiais.jpeg", titulo: "Soldas especiais" },
];
export const FOTO_CLIENTES = "/fotos-proposta/principais clientes.jpeg";
