function [ phi, theta, alpha, beta, gamma ] = determineAngles( number )

% -----------------------------------------------------------------------------------------------------------------
% [ alpha, beta, gamma ] = determineAngles( number )

% Angulos aleatorios para las particulas de un clúster
% 
% Input data:
% number:   número de angulos aleatorios (uno por cada partícula)
%
% Output data:
%
% phi:      
% theta:
% alpha:    componente x del vector unitario que apunta en la dirección del ángulo aleatorio
% beta:     componente y del vector unitario que apunta en la dirección del ángulo aleatorio
% gamma:    componente z del vector unitario que apunta en la dirección del ángulo aleatorio
%
% -----------------------------------------------------------------------------------------------------------------

%% Ángulos aleatorios
rng( 'shuffle' );           % Semilla para crear números aleatorios
phi   = zeros( number, 1 );
theta = zeros( number, 1 );
alpha = zeros( number, 1 );
beta  = zeros( number, 1 );
gamma = zeros( number, 1 );

for k = 1 : number
    phi( k, 1 )   = unifrnd( 0, 2 * pi( ) );
    theta( k, 1 ) = unifrnd( 0, pi( ) );
    %% Componentes unitarias en las direcciones x, y, z
    alpha( k, 1 ) = sin( theta( k, 1 ) ) * cos( phi( k, 1 ) );
    beta( k, 1 )  = sin( theta( k, 1 ) ) * sin( phi( k, 1 ) );
    gamma( k, 1 ) = cos( theta( k, 1 ) );
end
