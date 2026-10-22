/**
 * Versiona requisições de dados privados por identidade autenticada.
 *
 * Uma resposta só pode alterar a UI se for a requisição mais recente do
 * mesmo usuário. A invalidação cobre logout, troca de usuário e revogação.
 * Não substitui autenticação/autorização do backend.
 */
export function createWholesaleRequestGate() {
  let version = 0;

  return {
    begin(userId: string) {
      return { version: ++version, userId };
    },
    invalidate() {
      version += 1;
    },
    isCurrent(request: { version: number; userId: string }, userId: string | null) {
      return request.version === version && request.userId === userId;
    },
  };
}
