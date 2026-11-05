"use client";

/**
 * Edição cadastral de produto existente.
 * O estoque é intencionalmente somente leitura nesta página:
 * quantidades devem ser alteradas pelo fluxo auditável de movimentações.
 * O backend verifica novamente perfil, empresa e referências informadas.
 */
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { MenuLateral } from "../../../componentes/menu-lateral";
import styles from "./editar-produto.module.css";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5433").replace(/\/$/, "");

type Perfil = "ADMINISTRADOR" | "GERENTE" | "CAIXA" | "ATENDENTE" | "GARCOM";
type Identidade = { perfil?: Perfil };
type Categoria = { id: string; nome: string; categoriaPaiId: string | null };
type Unidade = { id: string; codigo: string; nome: string };
type Produto = {
  id: string;
  nome: string;
  sku: string;
  descricao: string | null;
  codigoBarras: string | null;
  categoriaId: string | null;
  unidadeId: string | null;
  preco: number | string;
  custo: number | string;
  saldoEstoque?: {
    quantidadeDisponivel: number | string;
    quantidadeReservada: number | string;
    estoqueMinimo: number | string;
  } | null;
};
type Formulario = {
  nome: string;
  sku: string;
  descricao: string;
  codigoBarras: string;
  categoriaId: string;
  unidadeId: string;
  preco: string;
  custo: string;
};
const vazio: Formulario = {
  nome: "", sku: "", descricao: "", codigoBarras: "",
  categoriaId: "", unidadeId: "", preco: "", custo: "",
};

function mensagemErro(dados: unknown, alternativa: string): string {
  if (dados !== null && typeof dados === "object" && "message" in dados) {
    const mensagem = (dados as { message: unknown }).message;
    if (typeof mensagem === "string") return mensagem;
    if (Array.isArray(mensagem)) return mensagem.join(", ");
  }
  return alternativa;
}

/** As APIs de consulta atuais podem devolver um array ou dados paginados. */
function listaDaApi<T>(dados: unknown): T[] {
  if (Array.isArray(dados)) return dados as T[];
  if (dados && typeof dados === "object" && "dados" in dados) {
    const lista = (dados as { dados: unknown }).dados;
    if (Array.isArray(lista)) return lista as T[];
  }
  throw new Error("Formato de listagem inválido na API.");
}

function formularioDoProduto(produto: Produto): Formulario {
  return {
    nome: produto.nome,
    sku: produto.sku,
    descricao: produto.descricao ?? "",
    codigoBarras: produto.codigoBarras ?? "",
    categoriaId: produto.categoriaId ?? "",
    unidadeId: produto.unidadeId ?? "",
    preco: String(produto.preco),
    custo: String(produto.custo),
  };
}

function ConteudoEditarProduto() {
  const router = useRouter();
  const parametros = useParams<{ id: string }>();
  const produtoId = parametros.id;
  const [nomeEmpresa, setNomeEmpresa] = useState("Empresa autenticada");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [autorizado, setAutorizado] = useState(false);
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState("");
  const [produto, setProduto] = useState<Produto | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [formulario, setFormulario] = useState<Formulario>({ ...vazio });

  useEffect(() => {
    let ativo = true;

    // Esta informação é apenas visual. O servidor decide acesso e empresa pelo JWT.
    try {
      const usuario = JSON.parse(sessionStorage.getItem("gestao.usuario") ?? "{}") as { empresaNome?: unknown };
      if (typeof usuario.empresaNome === "string" && usuario.empresaNome.trim()) {
        setNomeEmpresa(usuario.empresaNome.trim());
      }
    } catch {
      // Sessão malformada não autoriza operações.
    }

    async function carregar() {
      const token = sessionStorage.getItem("gestao.accessToken");
      if (!token) {
        router.replace("/");
        return;
      }

      // Reusa o token da sessão; não recebe empresaId na URL ou no formulário.
      async function consultar(caminho: string): Promise<unknown> {
        const resposta = await fetch(`${API_URL}${caminho}`, {
          cache: "no-store",
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        });
        if (resposta.status === 401) {
          sessionStorage.removeItem("gestao.accessToken");
          sessionStorage.removeItem("gestao.usuario");
          router.replace("/");
          throw new Error("Sessão expirada. Faça login novamente.");
        }
        const dados: unknown = await resposta.json().catch(() => null);
        if (!resposta.ok) throw new Error(mensagemErro(dados, `Falha HTTP ${resposta.status}.`));
        return dados;
      }

      try {
        const identidade = await consultar("/usuarios/me") as Identidade;
        if (identidade.perfil !== "ADMINISTRADOR" && identidade.perfil !== "GERENTE") {
          throw new Error("A edição de produtos é restrita a administradores e gerentes.");
        }
        if (!ativo) return;
        setAutorizado(true);

        // Recarrega os dados atuais para evitar editar uma linha de listagem desatualizada.
        const [dadosProduto, dadosCategorias, dadosUnidades] = await Promise.all([
          consultar(`/produtos/${encodeURIComponent(produtoId)}`),
          consultar("/categorias"),
          consultar("/unidades"),
        ]);
        if (!ativo) return;
        const item = dadosProduto as Produto | null;
        if (!item || item.id !== produtoId || typeof item.nome !== "string") {
          throw new Error("Resposta inválida ao consultar o produto.");
        }
        setProduto(item);
        setFormulario(formularioDoProduto(item));
        setCategorias(listaDaApi<Categoria>(dadosCategorias));
        setUnidades(listaDaApi<Unidade>(dadosUnidades));
      } catch (falha) {
        if (ativo) setErro(falha instanceof Error ? falha.message : "Não foi possível carregar o produto.");
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    void carregar();
    return () => { ativo = false; };
  }, [produtoId, router]);

  function atualizar<K extends keyof Formulario>(campo: K, valor: Formulario[K]) {
    setFormulario((atual) => ({ ...atual, [campo]: valor }));
    setErro("");
    setSucesso("");
  }

  function nomeHierarquico(categoria: Categoria): string {
    const mapa = new Map(categorias.map((item) => [item.id, item]));
    const nomes: string[] = [];
    const visitados = new Set<string>();
    let atual: Categoria | undefined = categoria;
    // Protege a exibição também se houver dados antigos com referência circular.
    while (atual && !visitados.has(atual.id)) {
      nomes.unshift(atual.nome);
      visitados.add(atual.id);
      atual = atual.categoriaPaiId ? mapa.get(atual.categoriaPaiId) : undefined;
    }
    return nomes.join(" / ");
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!produto || !autorizado || salvando) return;
    setErro("");
    setSucesso("");

    const nome = formulario.nome.trim();
    const sku = formulario.sku.trim().toUpperCase();
    const preco = Number(formulario.preco);
    const custo = Number(formulario.custo);
    if (!nome || !sku || nome.length > 150 || sku.length > 100) {
      setErro("Informe um nome (até 150 caracteres) e SKU (até 100 caracteres).");
      return;
    }
    if (!formulario.preco.trim() || !formulario.custo.trim() ||
        !Number.isFinite(preco) || !Number.isFinite(custo) ||
        preco < 0 || custo < 0 ||
        !/^\d+(\.\d{1,2})?$/.test(formulario.preco) ||
        !/^\d+(\.\d{1,2})?$/.test(formulario.custo)) {
      setErro("Preço e custo devem ser valores não negativos, com até duas casas decimais.");
      return;
    }

    // Monta payload apenas com os dados cadastrais realmente alterados.
    // Nunca envia saldoEstoque, quantidadeInicial, estoqueMinimo ou empresaId.
    const corpo: Record<string, string | number | null> = {};
    if (nome !== produto.nome) corpo.nome = nome;
    if (sku !== produto.sku) corpo.sku = sku;
    if (formulario.descricao.trim() !== (produto.descricao ?? "")) corpo.descricao = formulario.descricao.trim() || null;
    if (formulario.codigoBarras.trim() !== (produto.codigoBarras ?? "")) corpo.codigoBarras = formulario.codigoBarras.trim() || null;
    if (formulario.categoriaId !== (produto.categoriaId ?? "")) corpo.categoriaId = formulario.categoriaId || null;
    if (formulario.unidadeId !== (produto.unidadeId ?? "")) corpo.unidadeId = formulario.unidadeId || null;
    if (preco !== Number(produto.preco)) corpo.preco = preco;
    if (custo !== Number(produto.custo)) corpo.custo = custo;

    if (Object.keys(corpo).length === 0) {
      setErro("Nenhuma alteração foi informada.");
      return;
    }
    const token = sessionStorage.getItem("gestao.accessToken");
    if (!token) {
      router.replace("/");
      return;
    }
    setSalvando(true);
    try {
      const resposta = await fetch(`${API_URL}/produtos/${encodeURIComponent(produto.id)}`, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(corpo),
      });
      if (resposta.status === 401) {
        sessionStorage.removeItem("gestao.accessToken");
        sessionStorage.removeItem("gestao.usuario");
        router.replace("/");
        return;
      }
      const dados: unknown = await resposta.json().catch(() => null);
      if (!resposta.ok) throw new Error(mensagemErro(dados, "Não foi possível atualizar o produto."));
      // Atualiza referência original para evitar reenviar a mesma alteração.
      setProduto((atual) => atual ? { ...atual, ...corpo } as Produto : atual);
      setSucesso("Produto atualizado com sucesso. O saldo de estoque não foi alterado.");
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Falha ao salvar a edição.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className={styles.layout}>
      <MenuLateral nomeEmpresa={nomeEmpresa} />
      <main className={styles.main}>
        <div className={styles.cabecalho}>
          <div>
            <h1>Editar produto</h1>
            <p>Corrija informações cadastrais sem alterar a movimentação de estoque.</p>
          </div>
          <button type="button" className={styles.secundario} onClick={() => router.push("/produtos")}>Voltar aos produtos</button>
        </div>

        {carregando ? <p>Carregando produto e verificando permissões...</p> :
          !autorizado || !produto ? <p role="alert" className={styles.erro}>{erro || "Produto indisponível."}</p> : (
          <section className={styles.cartao}>
            <p className={styles.id}>Identificador: {produto.id}</p>
            <form onSubmit={salvar} className={styles.formulario}>
              <label className={styles.largo}>Nome do produto *
                <input required maxLength={150} value={formulario.nome} onChange={(e) => atualizar("nome", e.target.value)} disabled={salvando}/>
              </label>
              <label>SKU / Código *
                <input required maxLength={100} value={formulario.sku} onChange={(e) => atualizar("sku", e.target.value)} disabled={salvando}/>
              </label>
              <label>Código de barras
                <input maxLength={100} value={formulario.codigoBarras} onChange={(e) => atualizar("codigoBarras", e.target.value)} disabled={salvando}/>
              </label>
              <label className={styles.largo}>Descrição
                <input maxLength={1000} value={formulario.descricao} onChange={(e) => atualizar("descricao", e.target.value)} disabled={salvando}/>
              </label>
              <label>Categoria
                <select value={formulario.categoriaId} onChange={(e) => atualizar("categoriaId", e.target.value)} disabled={salvando}>
                  <option value="">Sem categoria</option>
                  {categorias.map((categoria) => <option value={categoria.id} key={categoria.id}>{nomeHierarquico(categoria)}</option>)}
                </select>
              </label>
              <label>Unidade de medida
                <select value={formulario.unidadeId} onChange={(e) => atualizar("unidadeId", e.target.value)} disabled={salvando}>
                  <option value="">Sem unidade</option>
                  {unidades.map((unidade) => <option value={unidade.id} key={unidade.id}>{unidade.codigo} — {unidade.nome}</option>)}
                </select>
              </label>
              <label>Preço de venda (R$) *
                <input type="number" required min="0" step="0.01" value={formulario.preco} onChange={(e) => atualizar("preco", e.target.value)} disabled={salvando}/>
              </label>
              <label>Custo (R$) *
                <input type="number" required min="0" step="0.01" value={formulario.custo} onChange={(e) => atualizar("custo", e.target.value)} disabled={salvando}/>
              </label>
              <div className={styles.largo}>
                <h2>Estoque (somente leitura)</h2>
                <p>Disponível: {String(produto.saldoEstoque?.quantidadeDisponivel ?? "Sem saldo")}
                  {" · "}Reservado: {String(produto.saldoEstoque?.quantidadeReservada ?? "Sem saldo")}</p>
                <p>Para movimentar quantidades, utilize a opção Movimentar na página de produtos.</p>
              </div>
              {erro && <p role="alert" className={`${styles.erro} ${styles.largo}`}>{erro}</p>}
              {sucesso && <p role="status" className={`${styles.sucesso} ${styles.largo}`}>{sucesso}</p>}
              <div className={`${styles.acoes} ${styles.largo}`}>
                <button type="button" className={styles.secundario} onClick={() => router.push("/produtos")} disabled={salvando}>Cancelar / Voltar</button>
                <button type="submit" className={styles.primario} disabled={salvando}>{salvando ? "Salvando..." : "Salvar alterações"}</button>
              </div>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}

/**
 * O segmento [id] depende de dados da URL disponíveis somente em tempo de execução.
 * O limite Suspense mantém uma interface inicial durante o prerender do Next.js 16,
 * sem alterar a busca, as permissões ou o salvamento do produto.
 */
export default function EditarProdutoPage() {
  return (
    <Suspense fallback={<main role="status" style={{ padding: "24px" }}>Carregando edição do produto...</main>}>
      <ConteudoEditarProduto />
    </Suspense>
  );
}
