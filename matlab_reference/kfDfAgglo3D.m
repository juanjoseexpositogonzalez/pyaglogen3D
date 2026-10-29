function [ clusters, referencias, intentos, vec, deltas, total_rot, solape, kf, Df ] = kfDfAgglo3D( nop, dpo, solape, kf, Df, metodo )
% [ clusters, referencias, intentos, vec, deltas, total_rot ] = kfDfAgglo3D( nop, dpo, solape, kf, Df, metodo )
% Implementa un metodo de creación de aglomerados tridimensionales
% tuneables
%
    solape_minimo = 1;      % Solape mínimo
    solape_maximo = 1.7;    % Solape maximo

    switch upper( metodo )
        case 'PC'
            %% Variables iniciales
            semilla = 2;            % Número de particulas del aglomerado inicial
            max_rotaciones = 25;    % Maximo número de rotaciones
            %% Creamos el cluster inicial de las particulas indicadas en la semilla
            %% Vemos si el resto de variables son aleatorias o no
            % Sembramos la semilla para aleatorizar el numero de particulas primarias
            rng( 'shuffle' ); 
            % Vemos si hay que utilizar alguna funcion de probabilidad
            if iscell( nop )
                switch( lower( nop{ 3 } ) )
                    case 'uniform'
                        nop = randi( [ nop{ 1 } nop{ 2 } ] );
                    case 'normal'
                        nop = ceil( normrnd( nop{ 1 }, nop{ 2 } ) );
                end
            end
            if iscell( dpo )
                switch( lower( dpo{ 3 } ) )
                    case 'uniform'
                        if ( dpo{ 1 } > dpo{ 2 } )
                            temp  = dpo{ 2 };
                            dpo{ 2 } = dpo{ 1 };
                            dpo{ 1 } = temp;
                        end
                        dpo = unifrnd( dpo{ 1 }, dpo{ 2 }, nop - 1, 1 );
                    case 'normal'
                        if ( dpo{ 1 } - dpo{ 2 } < 0 )
                            msg = 'Parameters for normal distribution would render possibly negative diameters';
                            error( msg );
                        end
                        dpo = normrnd( dpo{ 1 }, dpo{ 2 }, nop - 1, 1 );
                end
            end
            if iscell( solape )
                switch ( lower( solape{ 3 } ) )
                    case 'uniform'
                        if ( solape{ 1 } > solape{ 2 } )
                            temp  = solape{ 2 };
                            solape{ 2 } = solape{ 1 };
                            solape{ 1 } = temp;
                        end
                        solape = unifrnd( solape{ 1 }, solape{ 2 }, nop - 1, 1 );
                    case 'normal'
                        if ( solape{ 1 } - solape{ 2 } < solape_minimo || ...
                                solape{ 1 } + solape{ 2 } > solape_maximo )
                            msg = 'Parameters for normal distribution would render possibly values out of range';
                            error( msg );
                        end
                        solape = normrnd( solape{ 1 }, solape{ 2 }, nop - 1, 1 );
                end
            end
            if iscell( kf )
                switch ( lower( kf{ 3 } ) )
                    case 'uniform'
                        if ( kf{ 1 } > kf{ 2 } )
                            temp  = kf{ 2 };
                            kf{ 2 } = kf{ 1 };
                            kf{ 1 } = temp;
                        end
                        kf = unifrnd( kf{ 1 }, kf{ 2 }, 1, 1 );
                    case 'normal'
                        if ( kf{ 1 } - kf{ 2 } < 0 )
                            msg = 'Parameters for normal distribution would render possibly values out of range';
                            error( msg );
                        end
                        kf = normrnd( kf{ 1 }, kf{ 2 }, 1, 1 );
                end
            end
            if iscell( Df )
                switch ( lower( Df{ 3 } ) )
                    case 'uniform'
                        if ( Df{ 1 } > Df{ 2 } )
                            temp  = Df{ 2 };
                            Df{ 2 } = Df{ 1 };
                            Df{ 1 } = temp;
                        end
                        Df = unifrnd( Df{ 1 }, Df{ 2 }, 1, 1 );
                    case 'normal'
                        if ( Df{ 1 } - Df{ 2 } < 1 || ...
                                Df{ 1 } + Df{ 2 } > 3 )
                            msg = 'Parameters for normal distribution would render possibly values out of range';
                            error( msg );
                        end
                        Df = normrnd( Df{ 1 }, Df{ 2 }, 1, 1 );
                end
            end
            [ clusters, referencias, intentos, deltas, total_rot, solape, kf, Df ] = TuningPC( nop, dpo, solape, kf, Df, semilla, max_rotaciones );
        case 'CC'
            
    end % Switch
    
    vec = determinarVecindad( clusters );
                
end % function


